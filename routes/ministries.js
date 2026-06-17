const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM ministries WHERE is_active = true ORDER BY display_order ASC, name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch ministries.' });
  }
});

router.get('/all', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ministries ORDER BY display_order ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch ministries.' });
  }
});

router.post('/', authenticate, async (req, res) => {
  const { name, description, leader_name, leader_email, meeting_schedule, image_url, category, display_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Ministry name required.' });

  try {
    const result = await pool.query(
      `INSERT INTO ministries (name, description, leader_name, leader_email, meeting_schedule, image_url, category, display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, description, leader_name, leader_email, meeting_schedule, image_url, category, display_order || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create ministry.' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  const { name, description, leader_name, leader_email, meeting_schedule, image_url, category, display_order, is_active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE ministries SET name=$1, description=$2, leader_name=$3, leader_email=$4,
       meeting_schedule=$5, image_url=$6, category=$7, display_order=$8, is_active=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [name, description, leader_name, leader_email, meeting_schedule, image_url, category, display_order, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update ministry.' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM ministries WHERE id = $1', [req.params.id]);
    res.json({ message: 'Ministry deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete ministry.' });
  }
});

module.exports = router;