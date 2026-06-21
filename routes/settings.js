const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// GET /api/settings — public
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM church_settings');
    const settings = {};
    result.rows.forEach(row => { settings[row.key] = row.value; });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

// GET /api/settings/full — admin
router.get('/full', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM church_settings ORDER BY key ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

// PUT /api/settings — admin
router.put('/', authenticate, async (req, res) => {
  const updates = req.body;
  if (!updates || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No settings provided.' });
  }
  try {
    const promises = Object.entries(updates).map(([key, value]) =>
      pool.query(
        `INSERT INTO church_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value]
      )
    );
    await Promise.all(promises);
    res.json({ message: 'Settings updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings.' });
  }
});

// GET /api/settings/service-times — public
router.get('/service-times', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM service_times WHERE is_active = true ORDER BY display_order ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch service times.' });
  }
});

// POST /api/settings/service-times — admin
router.post('/service-times', authenticate, async (req, res) => {
  const { day_of_week, service_name, start_time, end_time, location_detail, description, display_order } = req.body;
  if (!day_of_week || !service_name || !start_time) {
    return res.status(400).json({ error: 'Day, service name, and start time required.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO service_times (day_of_week, service_name, start_time, end_time, location_detail, description, display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [day_of_week, service_name, start_time, end_time, location_detail, description, display_order || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create service time.' });
  }
});

// PUT /api/settings/service-times/:id — admin
router.put('/service-times/:id', authenticate, async (req, res) => {
  const { day_of_week, service_name, start_time, end_time, location_detail, description, display_order, is_active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE service_times SET day_of_week=$1, service_name=$2, start_time=$3, end_time=$4,
       location_detail=$5, description=$6, display_order=$7, is_active=$8
       WHERE id=$9 RETURNING *`,
      [day_of_week, service_name, start_time, end_time, location_detail, description, display_order, is_active, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update service time.' });
  }
});

// DELETE /api/settings/service-times/:id — admin
router.delete('/service-times/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM service_times WHERE id = $1', [req.params.id]);
    res.json({ message: 'Service time deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete service time.' });
  }
});

module.exports = router;