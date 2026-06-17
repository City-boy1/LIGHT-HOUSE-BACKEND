const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const router = express.Router();
const { upload, uploadImage, deleteFromCloudinary } = require('../middleware/upload');
const { sendMemberWelcome } = require('../utils/mailer');

// GET /api/members — all members (admin)
router.get('/', authenticate, async (req, res) => {
  try {
    const { group, status, search } = req.query;
    let query = `
      SELECT m.*, mi.name as ministry_name
      FROM members m
      LEFT JOIN ministries mi ON m.ministry_id = mi.id
      WHERE 1=1
    `;
    const params = [];

    if (status) { params.push(status); query += ` AND m.membership_status = $${params.length}`; }
    if (search) { params.push(`%${search}%`); query += ` AND (m.full_name ILIKE $${params.length} OR m.email ILIKE $${params.length} OR m.phone ILIKE $${params.length})`; }

    query += ` ORDER BY m.full_name ASC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch members.' });
  }
});

// GET /api/members/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.*, mi.name as ministry_name FROM members m
       LEFT JOIN ministries mi ON m.ministry_id = mi.id
       WHERE m.id = $1`, [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Member not found.' });

    // Also get their group memberships
    const groups = await pool.query(
      `SELECT g.id, g.name, g.category FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.member_id = $1`, [req.params.id]
    );
    const member = result.rows[0];
    member.groups = groups.rows;
    res.json(member);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch member.' });
  }
});

// POST /api/members
router.post('/', authenticate, upload.single('image'), async (req, res) => {
  const {
    full_name, email, phone, date_of_birth, gender, address, occupation,
    marital_status, membership_status, primary_group, ministry_id,
    baptism_date, join_date, notes
  } = req.body;

  if (!full_name) return res.status(400).json({ error: 'Full name is required.' });

  let image_url = null, cloudinary_public_id = null;
  if (req.file) {
    try {
      const result = await uploadImage(req.file.buffer, 'lighthouse/members');
      image_url = result.secure_url;
      cloudinary_public_id = result.public_id;
    } catch (err) {
      console.error('Image upload failed:', err.message);
      return res.status(500).json({ error: 'Image upload failed.' });
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO members (full_name, email, phone, date_of_birth, gender, address, occupation,
       marital_status, membership_status, primary_group, ministry_id, baptism_date, join_date, notes, image_url, cloudinary_public_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [full_name, email || null, phone || null, date_of_birth || null, gender || null,
       address || null, occupation || null, marital_status || null,
       membership_status || 'regular', primary_group || null,
       ministry_id || null, baptism_date || null,
       join_date || new Date().toISOString().slice(0, 10), notes || null,
       image_url, cloudinary_public_id]
    );
    const newMember = result.rows[0];
    sendMemberWelcome(newMember).catch(() => {});
    res.status(201).json(newMember);
  } catch (err) {
    if (cloudinary_public_id) await deleteFromCloudinary(cloudinary_public_id);
    if (err.code === '23505') return res.status(409).json({ error: 'A member with this email already exists.' });
    console.error(err);
    res.status(500).json({ error: 'Failed to add member.' });
  }
});
// PUT /api/members/:id
router.put('/:id', authenticate, upload.single('image'), async (req, res) => {
  const {
    full_name, email, phone, date_of_birth, gender, address, occupation,
    marital_status, membership_status, primary_group, ministry_id,
    baptism_date, join_date, notes, is_active
  } = req.body;

  let image_url = req.body.image_url || null;
  let cloudinary_public_id = req.body.cloudinary_public_id || null;

  if (req.file) {
    // Delete old image first
    if (cloudinary_public_id) await deleteFromCloudinary(cloudinary_public_id);
    try {
      const result = await uploadImage(req.file.buffer, 'lighthouse/members');
      image_url = result.secure_url;
      cloudinary_public_id = result.public_id;
    } catch (err) {
      console.error('Image upload failed:', err.message);
      return res.status(500).json({ error: 'Image upload failed.' });
    }
  }

  try {
    const result = await pool.query(
      `UPDATE members SET full_name=$1, email=$2, phone=$3, date_of_birth=$4, gender=$5,
       address=$6, occupation=$7, marital_status=$8, membership_status=$9, primary_group=$10,
       ministry_id=$11, baptism_date=$12, join_date=$13, notes=$14, is_active=$15,
       image_url=$16, cloudinary_public_id=$17, updated_at=NOW()
       WHERE id=$18 RETURNING *`,
      [full_name, email || null, phone || null, date_of_birth || null, gender || null,
       address || null, occupation || null, marital_status || null,
       membership_status || 'regular', primary_group || null,
       ministry_id || null, baptism_date || null, join_date || null,
       notes || null, is_active !== false,
       image_url, cloudinary_public_id, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Member not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update member.' });
  }
});

// DELETE /api/members/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const existing = await pool.query('SELECT cloudinary_public_id FROM members WHERE id=$1', [req.params.id]);
    if (existing.rows[0]?.cloudinary_public_id) {
      await deleteFromCloudinary(existing.rows[0].cloudinary_public_id);
    }
    await pool.query('DELETE FROM group_members WHERE member_id = $1', [req.params.id]);
    await pool.query('DELETE FROM members WHERE id = $1', [req.params.id]);
    res.json({ message: 'Member deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete member.' });
  }
});

module.exports = router;