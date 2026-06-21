// ============================================================
// GALLERY ROUTES — /api/gallery
// Lighthouse Church — The Quodesh Family Church
//
// Supports:
//   • Real file upload → Cloudinary (image)
//   • OR plain image_url paste (backwards compatible)
//   • Archive (hide from public, keep file on Cloudinary)
//   • Delete (removes from DB + Cloudinary)
// ============================================================

const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { upload, uploadImage, deleteFromCloudinary, validateFileSize } = require('../middleware/upload');
const router = express.Router();

// ── GET /api/gallery — public ───────────────────────────────
// ?album=X  filter by album name
// ?archived=true  (admin only — handled by /all instead for public)
router.get('/', async (req, res) => {
  const { album } = req.query;
  let query = 'SELECT * FROM gallery WHERE is_published = true AND is_archived = false';
  const params = [];
  if (album) {
    params.push(album);
    query += ` AND album = $${params.length}`;
  }
  query += ' ORDER BY display_order ASC, created_at DESC';
  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Gallery fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch gallery.' });
  }
});

// ── GET /api/gallery/albums — public ───────────────────────
router.get('/albums', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT album FROM gallery
       WHERE is_published = true AND is_archived = false
       ORDER BY album ASC`
    );
    res.json(result.rows.map(r => r.album));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch albums.' });
  }
});

// ── GET /api/gallery/all — admin ────────────────────────────
// Returns ALL items including drafts and archived
router.get('/all', authenticate, async (req, res) => {
  const { album, archived } = req.query;
  let query = 'SELECT * FROM gallery WHERE 1=1';
  const params = [];
  if (album) { params.push(album); query += ` AND album = $${params.length}`; }
  if (archived === 'true') {
    query += ' AND is_archived = true';
  } else if (archived === 'false') {
    query += ' AND is_archived = false';
  }
  query += ' ORDER BY created_at DESC';
  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch gallery.' });
  }
});

// ── POST /api/gallery — admin ───────────────────────────────
// Accepts multipart/form-data with field "image" (file upload)
// OR application/json with field "image_url" (URL paste)
router.post('/', authenticate, upload.single('image'), async (req, res) => {
  const { title, caption, album, display_order, image_url, cloudinary_public_id } = req.body;

  let finalImageUrl = image_url || null;
  let cloudinaryPublicId = cloudinary_public_id || null;

  // If a file was uploaded, push it to Cloudinary
  if (req.file) {
    try {
      validateFileSize(req.file);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    try {
      const result = await uploadImage(req.file.buffer, 'lighthouse/gallery');
      finalImageUrl = result.secure_url;
      cloudinaryPublicId = result.public_id;
    } catch (err) {
      console.error('Cloudinary upload error:', err);
      return res.status(500).json({ error: 'Image upload failed. Please try again.' });
    }
  }

  if (!finalImageUrl) {
    return res.status(400).json({ error: 'An image file or image URL is required.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO gallery
         (title, image_url, cloudinary_public_id, caption, album, display_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        title || null,
        finalImageUrl,
        cloudinaryPublicId,
        caption || null,
        album || 'General',
        display_order || 0,
        req.admin.id,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Gallery insert error:', err);
    // If DB insert fails but we already uploaded to Cloudinary, clean up
    if (cloudinaryPublicId) {
      await deleteFromCloudinary(cloudinaryPublicId, 'image');
    }
    res.status(500).json({ error: 'Failed to save gallery item.' });
  }
});

// ── PUT /api/gallery/:id — admin ────────────────────────────
// Can update metadata, replace image, publish/unpublish, or archive
router.put('/:id', authenticate, upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const { title, caption, album, display_order, is_published, is_archived, image_url, cloudinary_public_id } = req.body;

  try {
    // Fetch existing row so we can clean up old Cloudinary file if replacing
    const existing = await pool.query('SELECT * FROM gallery WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Gallery item not found.' });
    }
    const item = existing.rows[0];

    let finalImageUrl = image_url || item.image_url;
    let cloudinaryPublicId = cloudinary_public_id || item.cloudinary_public_id;

    // If a new file is uploaded, replace the old one on Cloudinary
    if (req.file) {
      try {
        validateFileSize(req.file);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      try {
        const result = await uploadImage(req.file.buffer, 'lighthouse/gallery');
        finalImageUrl = result.secure_url;

        // Delete the old Cloudinary file AFTER successful new upload
        if (item.cloudinary_public_id) {
          await deleteFromCloudinary(item.cloudinary_public_id, 'image');
        }
        cloudinaryPublicId = result.public_id;
      } catch (err) {
        console.error('Cloudinary replace error:', err);
        return res.status(500).json({ error: 'Image upload failed. Old image kept.' });
      }
    }

    const result = await pool.query(
      `UPDATE gallery SET
         title = $1,
         image_url = $2,
         cloudinary_public_id = $3,
         caption = $4,
         album = $5,
         display_order = $6,
         is_published = $7,
         is_archived = $8
       WHERE id = $9
       RETURNING *`,
      [
        title       ?? item.title,
        finalImageUrl,
        cloudinaryPublicId,
        caption     ?? item.caption,
        album       ?? item.album,
        display_order !== undefined ? display_order : item.display_order,
        is_published !== undefined  ? is_published  : item.is_published,
        is_archived  !== undefined  ? is_archived   : item.is_archived,
        id,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Gallery update error:', err);
    res.status(500).json({ error: 'Failed to update gallery item.' });
  }
});

// ── DELETE /api/gallery/:id — admin ─────────────────────────
// Deletes from DB AND from Cloudinary
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const existing = await pool.query(
      'SELECT cloudinary_public_id FROM gallery WHERE id = $1',
      [req.params.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Gallery item not found.' });
    }

    const { cloudinary_public_id } = existing.rows[0];

    // Delete from DB first
    await pool.query('DELETE FROM gallery WHERE id = $1', [req.params.id]);

    // Then clean up Cloudinary (non-blocking — failure won't affect response)
    await deleteFromCloudinary(cloudinary_public_id, 'image');

    res.json({ message: 'Gallery item deleted successfully.' });
  } catch (err) {
    console.error('Gallery delete error:', err);
    res.status(500).json({ error: 'Failed to delete gallery item.' });
  }
});

module.exports = router;