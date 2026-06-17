const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const router = express.Router();
const { notifyNewPrayerRequest, notifyPrayerAnswered } = require('../utils/mailer');

// POST /api/prayer — public (submit a prayer request)
router.post('/', async (req, res) => {
  const { requester_name, email, phone, request_text, is_private } = req.body;
  if (!requester_name || !request_text) {
    return res.status(400).json({ error: 'Name and prayer request are required.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO prayer_requests (requester_name, email, phone, request_text, is_private)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, requester_name, created_at`,
      [requester_name, email, phone, request_text, is_private !== false]
    );
    const saved = result.rows[0];
    notifyNewPrayerRequest({ ...req.body, id: saved.id }).catch(() => {});
    res.status(201).json({
      message: 'Your prayer request has been received. The church is praying with you.',
      id: saved.id
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit prayer request.' });
  }
});

// GET /api/prayer — admin only
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM prayer_requests ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch prayer requests.' });
  }
});

// PUT /api/prayer/:id — admin (mark answered, add notes)
router.put('/:id', authenticate, async (req, res) => {
  const { is_answered, admin_notes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE prayer_requests SET is_answered=$1, admin_notes=$2, updated_at=NOW()
       WHERE id=$3 RETURNING *`,
      [is_answered, admin_notes, req.params.id]
    );
    const updated = result.rows[0];
    if (is_answered && updated.email) notifyPrayerAnswered(updated).catch(() => {});
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update prayer request.' });
  }
});

// DELETE /api/prayer/:id — admin
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM prayer_requests WHERE id = $1', [req.params.id]);
    res.json({ message: 'Prayer request deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete prayer request.' });
  }
});

module.exports = router;