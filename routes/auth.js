const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required.' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM admins WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const admin = result.rows[0];
    const valid = await bcrypt.compare(password, admin.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// GET /api/auth/me — verify token and return admin info
router.get('/me', authenticate, async (req, res) => {
  res.json({ admin: req.admin });
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both current and new password required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  try {
    const result = await pool.query('SELECT * FROM admins WHERE id = $1', [req.admin.id]);
    const admin = result.rows[0];
    const valid = await bcrypt.compare(currentPassword, admin.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [hash, req.admin.id]);

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/auth/create-admin (superadmin only)
router.post('/create-admin', authenticate, async (req, res) => {
  if (req.admin.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only superadmin can create new admins.' });
  }

  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password required.' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO admins (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [name, email.toLowerCase().trim(), hash, role || 'admin']
    );
    res.status(201).json({ admin: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An admin with this email already exists.' });
    }
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;