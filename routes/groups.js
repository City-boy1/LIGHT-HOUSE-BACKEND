const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// GET /api/groups — all groups with member counts
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*,
        CASE
          WHEN g.is_default THEN (
            SELECT COUNT(*)::int FROM members m
            WHERE m.primary_group = g.name AND m.is_active = true
          )
          ELSE (
            SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = g.id
          )
        END as member_count
      FROM groups g
      ORDER BY g.is_default DESC, g.name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch groups.' });
  }
});

// GET /api/groups/:id/members — members of a specific group
router.get('/:id/members', authenticate, async (req, res) => {
  try {
    const groupRes = await pool.query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
    if (!groupRes.rows.length) return res.status(404).json({ error: 'Group not found.' });
    const group = groupRes.rows[0];

    let result;
    if (group.is_default) {
      result = await pool.query(`
        SELECT m.*, null as role_in_group, null as joined_at
        FROM members m
        WHERE m.primary_group = $1 AND m.is_active = true
        ORDER BY m.full_name ASC
      `, [group.name]);
    } else {
      result = await pool.query(`
        SELECT m.*, gm.role_in_group, gm.joined_at
        FROM members m
        JOIN group_members gm ON m.id = gm.member_id
        WHERE gm.group_id = $1
        ORDER BY m.full_name ASC
      `, [req.params.id]);
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch group members.' });
  }
});

// POST /api/groups — create a new group
router.post('/', authenticate, async (req, res) => {
  const { name, description, category, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Group name is required.' });

  try {
    const result = await pool.query(
      `INSERT INTO groups (name, description, category, color, is_default)
       VALUES ($1,$2,$3,$4,false) RETURNING *`,
      [name, description || null, category || 'custom', color || '#143d6f']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A group with this name already exists.' });
    res.status(500).json({ error: 'Failed to create group.' });
  }
});

// PUT /api/groups/:id
router.put('/:id', authenticate, async (req, res) => {
  const { name, description, category, color } = req.body;
  try {
    const result = await pool.query(
      `UPDATE groups SET name=$1, description=$2, category=$3, color=$4, updated_at=NOW()
       WHERE id=$5 AND is_default=false RETURNING *`,
      [name, description, category, color, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Group not found or cannot edit default group.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update group.' });
  }
});

// DELETE /api/groups/:id — only custom groups
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const check = await pool.query('SELECT is_default FROM groups WHERE id=$1', [req.params.id]);
    if (!check.rows.length) return res.status(404).json({ error: 'Group not found.' });
    if (check.rows[0].is_default) return res.status(400).json({ error: 'Cannot delete default groups.' });

    await pool.query('DELETE FROM group_members WHERE group_id=$1', [req.params.id]);
    await pool.query('DELETE FROM groups WHERE id=$1', [req.params.id]);
    res.json({ message: 'Group deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete group.' });
  }
});

// POST /api/groups/:id/members — add member to group
router.post('/:id/members', authenticate, async (req, res) => {
  const { member_id, role_in_group } = req.body;
  if (!member_id) return res.status(400).json({ error: 'member_id required.' });

  try {
    await pool.query(
      `INSERT INTO group_members (group_id, member_id, role_in_group)
       VALUES ($1,$2,$3) ON CONFLICT (group_id, member_id) DO UPDATE SET role_in_group=$3`,
      [req.params.id, member_id, role_in_group || null]
    );
    res.json({ message: 'Member added to group.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add member to group.' });
  }
});

// DELETE /api/groups/:id/members/:memberId — remove member from group
router.delete('/:id/members/:memberId', authenticate, async (req, res) => {
  try {
    const check = await pool.query('SELECT is_default FROM groups WHERE id=$1', [req.params.id]);
    if (check.rows[0]?.is_default) {
      return res.status(400).json({ error: 'Cannot remove member from their primary group. Change their primary group in their profile instead.' });
    }
    await pool.query('DELETE FROM group_members WHERE group_id=$1 AND member_id=$2', [req.params.id, req.params.memberId]);
    res.json({ message: 'Member removed from group.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove member from group.' });
  }
});

module.exports = router;