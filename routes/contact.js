const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const router = express.Router();
const { notifyNewContactMessage } = require('../utils/mailer');

// POST /api/contact — public
router.post('/', async (req, res) => {
  const { name, email, phone, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }

  try {
    await pool.query(
      `INSERT INTO contact_messages (name, email, phone, subject, message)
       VALUES ($1,$2,$3,$4,$5)`,
      [name, email, phone, subject, message]
    );
    notifyNewContactMessage({ name, email, phone, subject, message }).catch(() => {});
    res.status(201).json({ message: 'Message received. We will get back to you soon. God bless you!' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message.' });
  }
});

// GET /api/contact — admin only
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM contact_messages ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages.' });
  }
});

// PUT /api/contact/:id/read — admin
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    await pool.query('UPDATE contact_messages SET is_read = true WHERE id = $1', [req.params.id]);
    res.json({ message: 'Marked as read.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update message.' });
  }
});

// DELETE /api/contact/:id — admin
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM contact_messages WHERE id = $1', [req.params.id]);
    res.json({ message: 'Message deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete message.' });
  }
});

module.exports = router;