const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// Simple sanitizer — strips HTML tags from strings
function sanitize(str) {
  if (!str) return str;
  return String(str).replace(/<[^>]*>/g, '').trim();
}

// GET /api/events — public
router.get('/', async (req, res) => {
  const { category, upcoming } = req.query;
  let query = `SELECT * FROM events WHERE is_published = true AND is_archived = false`;
  const params = [];

  if (upcoming === 'true') {
    query += ` AND (event_date >= CURRENT_DATE OR (end_date IS NOT NULL AND end_date >= CURRENT_DATE))`;
  }
  if (category && /^[a-zA-Z]+$/.test(category)) {
    params.push(category);
    query += ` AND category = $${params.length}`;
  }

  query += ` ORDER BY event_date ASC LIMIT 50`;

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch events.' });
  }
});

// GET /api/events/all — admin
router.get('/all', authenticate, async (req, res) => {
  const { archived } = req.query;
  try {
    const result = await pool.query(
      `SELECT * FROM events WHERE is_archived = $1 ORDER BY event_date ${archived === 'true' ? 'DESC' : 'ASC'}`,
      [archived === 'true']
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch events.' });
  }
});

// GET /api/events/:id — public
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch event.' });
  }
});

// POST /api/events — admin
router.post('/', authenticate, async (req, res) => {
  const {
    title, description, event_date, end_date, start_time, end_time,
    location, image_url, cloudinary_public_id, category,
    is_featured, is_published, registration_link
  } = req.body;

  if (!title || !event_date) return res.status(400).json({ error: 'Title and start date are required.' });
  if (end_date && end_date < event_date) return res.status(400).json({ error: 'End date cannot be before start date.' });

  try {
    const result = await pool.query(
      `INSERT INTO events (title, description, event_date, end_date, start_time, end_time,
       location, image_url, cloudinary_public_id, category, is_featured, is_published,
       registration_link, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        sanitize(title), sanitize(description), event_date, end_date || null,
        start_time || null, end_time || null, sanitize(location),
        image_url || null, cloudinary_public_id || null,
        sanitize(category) || 'general', is_featured || false,
        is_published !== false, registration_link || null, req.admin.id
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create event.' });
  }
});

// PUT /api/events/:id — admin
router.put('/:id', authenticate, async (req, res) => {
  const {
    title, description, event_date, end_date, start_time, end_time,
    location, image_url, cloudinary_public_id, category,
    is_featured, is_published, is_archived, registration_link
  } = req.body;

  if (end_date && event_date && end_date < event_date) {
    return res.status(400).json({ error: 'End date cannot be before start date.' });
  }

  try {
    const result = await pool.query(
      `UPDATE events SET title=$1, description=$2, event_date=$3, end_date=$4,
       start_time=$5, end_time=$6, location=$7, image_url=$8, cloudinary_public_id=$9,
       category=$10, is_featured=$11, is_published=$12, is_archived=$13,
       registration_link=$14, updated_at=NOW()
       WHERE id=$15 RETURNING *`,
      [
        sanitize(title), sanitize(description), event_date, end_date || null,
        start_time || null, end_time || null, sanitize(location),
        image_url || null, cloudinary_public_id || null,
        sanitize(category), is_featured, is_published,
        is_archived || false, registration_link || null, req.params.id
      ]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update event.' });
  }
});

// DELETE /api/events/:id — admin
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const existing = await pool.query('SELECT cloudinary_public_id FROM events WHERE id=$1', [req.params.id]);
    if (existing.rows.length && existing.rows[0].cloudinary_public_id) {
      const { deleteFromCloudinary } = require('../middleware/upload');
      await deleteFromCloudinary(existing.rows[0].cloudinary_public_id, 'image');
    }
    await pool.query('DELETE FROM events WHERE id = $1', [req.params.id]);
    res.json({ message: 'Event deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete event.' });
  }
});

// POST /api/events/auto-archive — called on server startup and daily
async function runAutoArchive() {
  try {
    const result = await pool.query(`
      UPDATE events SET is_archived = true, updated_at = NOW()
      WHERE is_archived = false
        AND is_published = true
        AND (
          (end_date IS NOT NULL AND end_date < CURRENT_DATE)
          OR (end_date IS NULL AND event_date < CURRENT_DATE)
        )
      RETURNING id
    `);
    if (result.rowCount > 0) console.log(`[auto-archive] Archived ${result.rowCount} past event(s).`);
  } catch (err) {
    console.error('[auto-archive] Failed:', err.message);
  }
}

router.runAutoArchive = runAutoArchive;
module.exports = router;