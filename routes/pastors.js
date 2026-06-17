// ============================================================
// PASTORS ROUTES — /api/pastors
// Lighthouse Church — The Quodesh Family Church
// ============================================================

const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { upload, uploadImage, deleteFromCloudinary } = require('../middleware/upload');
const router = express.Router();

// ── GET /api/pastors — public ───────────────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM pastors WHERE is_active = true ORDER BY display_order ASC, created_at ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pastors.' });
  }
});

// ── GET /api/pastors/:id — public ──────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM pastors WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Pastor not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pastor.' });
  }
});

// ── POST /api/pastors — admin ───────────────────────────────
// Accepts multipart/form-data with field "image" (file upload)
// OR application/json with field "image_url" (URL paste)
router.post('/', authenticate, upload.single('image'), async (req, res) => {
  const { name, title, bio, email, phone, image_url, display_order } = req.body;
  if (!name || !title) return res.status(400).json({ error: 'Name and title are required.' });

  let finalImageUrl = image_url || null;
  let cloudinaryPublicId = null;

  if (req.file) {
    try {
      const result = await uploadImage(req.file.buffer, 'lighthouse/pastors');
      finalImageUrl = result.secure_url;
      cloudinaryPublicId = result.public_id;
    } catch (err) {
      console.error('Cloudinary upload error:', err);
      return res.status(500).json({ error: 'Image upload failed. Please try again.' });
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO pastors
         (name, title, bio, email, phone, image_url, cloudinary_public_id, display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [name, title, bio || null, email || null, phone || null, finalImageUrl, cloudinaryPublicId, display_order || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    // DB failed — clean up Cloudinary upload
    if (cloudinaryPublicId) await deleteFromCloudinary(cloudinaryPublicId, 'image');
    console.error('Pastor insert error:', err);
    res.status(500).json({ error: 'Failed to create pastor.' });
  }
});

// ── PUT /api/pastors/:id — admin ────────────────────────────
router.put('/:id', authenticate, upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const { name, title, bio, email, phone, image_url, display_order, is_active } = req.body;

  try {
    const existing = await pool.query('SELECT * FROM pastors WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Pastor not found.' });
    const p = existing.rows[0];

    let finalImageUrl = image_url !== undefined ? image_url : p.image_url;
    let cloudinaryPublicId = p.cloudinary_public_id;

    // New image file uploaded — replace old one on Cloudinary
    if (req.file) {
      try {
        const result = await uploadImage(req.file.buffer, 'lighthouse/pastors');
        finalImageUrl = result.secure_url;
        if (p.cloudinary_public_id) await deleteFromCloudinary(p.cloudinary_public_id, 'image');
        cloudinaryPublicId = result.public_id;
      } catch (err) {
        console.error('Cloudinary replace error:', err);
        return res.status(500).json({ error: 'Image upload failed. Old image kept.' });
      }
    }

    const result = await pool.query(
      `UPDATE pastors SET
         name = $1, title = $2, bio = $3, email = $4, phone = $5,
         image_url = $6, cloudinary_public_id = $7,
         display_order = $8, is_active = $9, updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        name              ?? p.name,
        title             ?? p.title,
        bio               !== undefined ? bio               : p.bio,
        email             !== undefined ? email             : p.email,
        phone             !== undefined ? phone             : p.phone,
        finalImageUrl,
        cloudinaryPublicId,
        display_order     !== undefined ? display_order     : p.display_order,
        is_active         !== undefined ? is_active         : p.is_active,
        id,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Pastor update error:', err);
    res.status(500).json({ error: 'Failed to update pastor.' });
  }
});

// ── DELETE /api/pastors/:id — admin ─────────────────────────
// Deletes from DB + removes photo from Cloudinary
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const existing = await pool.query(
      'SELECT cloudinary_public_id FROM pastors WHERE id = $1',
      [req.params.id]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Pastor not found.' });

    const { cloudinary_public_id } = existing.rows[0];

    await pool.query('DELETE FROM pastors WHERE id = $1', [req.params.id]);
    await deleteFromCloudinary(cloudinary_public_id, 'image');

    res.json({ message: 'Pastor removed successfully.' });
  } catch (err) {
    console.error('Pastor delete error:', err);
    res.status(500).json({ error: 'Failed to delete pastor.' });
  }
});

module.exports = router;