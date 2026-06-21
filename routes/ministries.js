const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const router = express.Router();
const { deleteFromCloudinary } = require('../middleware/upload');

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
  const { name, description, leader_name, meeting_schedule, image_url, category, display_order, media_url, media_public_id, media_type } = req.body;
  if (!name) return res.status(400).json({ error: 'Ministry name required.' });

  try {
    const result = await pool.query(
      `INSERT INTO ministries (name, description, leader_name, meeting_schedule, image_url, category, display_order, media_url, media_public_id, media_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name, description || null, leader_name || null, meeting_schedule || null,
       image_url || null, category || null, display_order || 0,
       media_url || null, media_public_id || null, media_type || 'image']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create ministry.' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  const { name, description, leader_name, meeting_schedule, image_url, category, display_order, is_active, media_url, media_public_id, media_type } = req.body;
  try {
    const result = await pool.query(
      `UPDATE ministries SET name=$1, description=$2, leader_name=$3,
       meeting_schedule=$4, image_url=$5, category=$6, display_order=$7, is_active=$8,
       media_url=$9, media_public_id=$10, media_type=$11, updated_at=NOW()
       WHERE id=$12 RETURNING *`,
      [name, description || null, leader_name || null, meeting_schedule || null,
       image_url || null, category || null, display_order || 0,
       is_active !== false, media_url || null, media_public_id || null,
       media_type || 'image', req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update ministry.' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const existing = await pool.query('SELECT media_public_id, media_type, cloudinary_public_id FROM ministries WHERE id = $1', [req.params.id]);
    if (existing.rows[0]?.media_public_id) {
      const rtype = existing.rows[0].media_type === 'video' ? 'video' : 'image';
      await deleteFromCloudinary(existing.rows[0].media_public_id, rtype);
    }
    if (existing.rows[0]?.cloudinary_public_id) {
      await deleteFromCloudinary(existing.rows[0].cloudinary_public_id, 'image');
    }
    await pool.query('DELETE FROM ministries WHERE id = $1', [req.params.id]);
    res.json({ message: 'Ministry deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete ministry.' });
  }
});

module.exports = router;