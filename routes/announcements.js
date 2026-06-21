const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { deleteFromCloudinary } = require('../middleware/upload');
const router = express.Router();

// GET /api/announcements — public (only published, not expired)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, adm.name as created_by_name FROM announcements a
       LEFT JOIN admins adm ON a.created_by = adm.id
       WHERE a.is_published = true
       AND (a.expires_at IS NULL OR a.expires_at > NOW())
       ORDER BY a.is_pinned DESC, a.published_at DESC
       LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch announcements.' });
  }
});

// GET /api/announcements/all — admin only (all including unpublished)
router.get('/all', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, adm.name as created_by_name FROM announcements a
       LEFT JOIN admins adm ON a.created_by = adm.id
       ORDER BY a.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch announcements.' });
  }
});

// GET /api/announcements/:id — public
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM announcements WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch announcement.' });
  }
});

// POST /api/announcements — admin only
router.post('/', authenticate, async (req, res) => {
  const { title, body, category, image_url, cloudinary_public_id, video_url, is_pinned, is_published, expires_at } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body required.' });

  // Basic video URL validation
  if (video_url && video_url.trim()) {
    try { new URL(video_url.trim()); } catch { return res.status(400).json({ error: 'Invalid video URL.' }); }
  }

  try {
    const result = await pool.query(
      `INSERT INTO announcements (title, body, category, image_url, cloudinary_public_id, video_url, is_pinned, is_published, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [title, body, category || 'general', image_url || null, cloudinary_public_id || null,
       video_url?.trim() || null, is_pinned || false, is_published !== false, expires_at || null, req.admin.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create announcement.' });
  }
});

// PUT /api/announcements/:id — admin only
router.put('/:id', authenticate, async (req, res) => {
  const { title, body, category, image_url, cloudinary_public_id, video_url, is_pinned, is_published, expires_at } = req.body;

  if (video_url && video_url.trim()) {
    try { new URL(video_url.trim()); } catch { return res.status(400).json({ error: 'Invalid video URL.' }); }
  }

  try {
    const result = await pool.query(
      `UPDATE announcements SET title=$1, body=$2, category=$3, image_url=$4,
       cloudinary_public_id=$5, video_url=$6, is_pinned=$7, is_published=$8,
       expires_at=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [title, body, category, image_url || null, cloudinary_public_id || null,
       video_url?.trim() || null, is_pinned, is_published, expires_at, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update announcement.' });
  }
});

// PATCH /api/announcements/:id/clear-image — remove image only
router.patch('/:id/clear-image', authenticate, async (req, res) => {
  try {
    const { cloudinary_public_id } = req.body;
    if (cloudinary_public_id) {
      await deleteFromCloudinary(cloudinary_public_id, 'image');
    }
    await pool.query(
      `UPDATE announcements SET image_url = NULL, cloudinary_public_id = NULL, updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ message: 'Image removed.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove image.' });
  }
});

// DELETE /api/announcements/:id — admin only
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const existing = await pool.query(
      'SELECT cloudinary_public_id FROM announcements WHERE id = $1', [req.params.id]
    );
    if (existing.rows.length && existing.rows[0].cloudinary_public_id) {
      const { deleteFromCloudinary } = require('../middleware/upload');
      await deleteFromCloudinary(existing.rows[0].cloudinary_public_id, 'image');
    }
    await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
    res.json({ message: 'Announcement deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete announcement.' });
  }
});

module.exports = router;