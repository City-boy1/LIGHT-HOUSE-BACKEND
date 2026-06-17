const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { notifyNewRegistration, sendRegistrationConfirmation } = require('../utils/mailer');
const router = express.Router();

function sanitize(str) {
  if (!str) return null;
  return String(str).replace(/<[^>]*>/g, '').trim();
}

function generateRef(uuid) {
  // Take last 8 chars of the DB-generated UUID — guaranteed unique since UUID is unique
  const short = uuid.replace(/-/g, '').slice(-8).toUpperCase();
  return `LHC-${short}`;
}

// ── GET /api/eventforms/event/:eventId — public ─────────────
router.get('/event/:eventId', async (req, res) => {
  try {
    const form = await pool.query(
      `SELECT ef.*, e.title as event_title, e.event_date, e.end_date,
              e.start_time, e.location, e.image_url
       FROM event_forms ef
       JOIN events e ON ef.event_id = e.id
       WHERE ef.event_id = $1 AND ef.is_active = true AND e.is_published = true`,
      [req.params.eventId]
    );
    if (!form.rows.length) return res.status(404).json({ error: 'No active form found for this event.' });

    const fields = await pool.query(
      `SELECT * FROM event_form_fields WHERE form_id = $1 ORDER BY display_order ASC`,
      [form.rows[0].id]
    );
    res.json({ ...form.rows[0], fields: fields.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch form.' });
  }
});

// ── GET /api/eventforms/:id — admin ────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const form = await pool.query('SELECT * FROM event_forms WHERE id = $1', [req.params.id]);
    if (!form.rows.length) return res.status(404).json({ error: 'Form not found.' });
    const fields = await pool.query(
      'SELECT * FROM event_form_fields WHERE form_id = $1 ORDER BY display_order ASC',
      [req.params.id]
    );
    res.json({ ...form.rows[0], fields: fields.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch form.' });
  }
});

// ── GET /api/eventforms/event/:eventId/admin — admin ───────
router.get('/event/:eventId/admin', authenticate, async (req, res) => {
  try {
    const form = await pool.query(
      'SELECT * FROM event_forms WHERE event_id = $1',
      [req.params.eventId]
    );
    if (!form.rows.length) return res.json(null);
    const fields = await pool.query(
      'SELECT * FROM event_form_fields WHERE form_id = $1 ORDER BY display_order ASC',
      [form.rows[0].id]
    );
    res.json({ ...form.rows[0], fields: fields.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch form.' });
  }
});

// ── POST /api/eventforms — admin: create form ───────────────
router.post('/', authenticate, async (req, res) => {
  const { event_id, title, description, is_active, show_payment_info,
          payment_amount, payment_instructions, mtn_number, momo_provider, require_email, fields } = req.body;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM event_forms WHERE event_id=$1', [event_id]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A form already exists for this event. Edit it instead.' });
    }

    const form = await client.query(
      `INSERT INTO event_forms (event_id, title, description, is_active, show_payment_info,
       payment_amount, payment_instructions, mtn_number, momo_provider, require_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [event_id, sanitize(title), sanitize(description), is_active !== false,
       show_payment_info || false, payment_amount || null,
       sanitize(payment_instructions), sanitize(mtn_number),
       momo_provider || 'MTN MoMo', require_email || false]
    );
    const formId = form.rows[0].id;

    if (Array.isArray(fields) && fields.length) {
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        await client.query(
          `INSERT INTO event_form_fields (form_id, field_label, field_type, field_options,
           placeholder, is_required, display_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [formId, sanitize(f.field_label), f.field_type,
           f.field_options ? JSON.stringify(f.field_options) : null,
           sanitize(f.placeholder), f.is_required || false, i]
        );
      }
    }

    await client.query('COMMIT');
    const saved = await pool.query(
      'SELECT * FROM event_form_fields WHERE form_id=$1 ORDER BY display_order ASC', [formId]
    );
    res.status(201).json({ ...form.rows[0], fields: saved.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create form.' });
  } finally {
    client.release();
  }
});

// ── PUT /api/eventforms/:id — admin: update form ───────────
router.put('/:id', authenticate, async (req, res) => {
  const { title, description, is_active, show_payment_info,
          payment_amount, payment_instructions, mtn_number, momo_provider, require_email, fields } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const form = await client.query(
      `UPDATE event_forms SET title=$1, description=$2, is_active=$3,
       show_payment_info=$4, payment_amount=$5, payment_instructions=$6,
       mtn_number=$7, momo_provider=$8, require_email=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [sanitize(title), sanitize(description), is_active !== false,
       show_payment_info || false, payment_amount || null,
       sanitize(payment_instructions), sanitize(mtn_number),
       momo_provider || 'MTN MoMo', require_email || false, req.params.id]
    );
    if (!form.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Form not found.' });
    }

    // Replace all fields
    await client.query('DELETE FROM event_form_fields WHERE form_id=$1', [req.params.id]);
    if (Array.isArray(fields) && fields.length) {
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        await client.query(
          `INSERT INTO event_form_fields (form_id, field_label, field_type, field_options,
           placeholder, is_required, display_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [req.params.id, sanitize(f.field_label), f.field_type,
           f.field_options ? JSON.stringify(f.field_options) : null,
           sanitize(f.placeholder), f.is_required || false, i]
        );
      }
    }

    await client.query('COMMIT');
    const saved = await pool.query(
      'SELECT * FROM event_form_fields WHERE form_id=$1 ORDER BY display_order ASC', [req.params.id]
    );
    res.json({ ...form.rows[0], fields: saved.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to update form.' });
  } finally {
    client.release();
  }
});

// ── DELETE /api/eventforms/:id — admin ─────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM event_form_fields WHERE form_id=$1', [req.params.id]);
    await pool.query('DELETE FROM event_registrations WHERE form_id=$1', [req.params.id]);
    await pool.query('DELETE FROM event_forms WHERE id=$1', [req.params.id]);
    res.json({ message: 'Form deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete form.' });
  }
});

// ── POST /api/eventforms/:id/register — public ─────────────
router.post('/:id/register', async (req, res) => {
  const { respondent_name, respondent_email, respondent_phone, responses } = req.body;
  if (!respondent_name) return res.status(400).json({ error: 'Your name is required.' });

  try {
    const form = await pool.query(
      `SELECT ef.*, e.title as event_title, e.event_date, e.location
       FROM event_forms ef JOIN events e ON ef.event_id = e.id
       WHERE ef.id = $1 AND ef.is_active = true`,
      [req.params.id]
    );
    if (!form.rows.length) return res.status(404).json({ error: 'This registration form is not available.' });

    const f = form.rows[0];
    if (f.require_email && !respondent_email) {
      return res.status(400).json({ error: 'Email address is required for this event.' });
    }

    // Validate required fields
    const fields = await pool.query(
      'SELECT * FROM event_form_fields WHERE form_id=$1 ORDER BY display_order ASC', [req.params.id]
    );
    for (const field of fields.rows) {
      if (field.is_required && (!responses || !responses[field.id])) {
        return res.status(400).json({ error: `"${field.field_label}" is required.` });
      }
    }

    const reg = await pool.query(
      `INSERT INTO event_registrations
       (form_id, event_id, respondent_name, respondent_email, respondent_phone, responses, payment_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, f.event_id, sanitize(respondent_name),
       respondent_email || null, sanitize(respondent_phone),
       JSON.stringify(responses || {}), 'PENDING']
    );

    const registration = reg.rows[0];
    const ref = generateRef(registration.id);

    // Update the reference now that we have the UUID
    await pool.query(
      'UPDATE event_registrations SET payment_reference=$1 WHERE id=$2',
      [ref, registration.id]
    );
    registration.payment_reference = ref;

    // Fire emails
    sendRegistrationConfirmation({
      registration, form: f, fields: fields.rows
    }).catch(() => {});
    notifyNewRegistration({
      registration, form: f
    }).catch(() => {});

    res.status(201).json({
      message: 'Registration successful!',
      reference: ref,
      payment_required: f.show_payment_info,
      mtn_number: f.show_payment_info ? f.mtn_number : null,
      momo_provider: f.show_payment_info ? f.momo_provider : null,
      payment_amount: f.show_payment_info ? f.payment_amount : null,
      payment_instructions: f.show_payment_info ? f.payment_instructions : null,
      event_title: f.event_title,
      event_date: f.event_date,
      location: f.location
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'You have already registered for this event with this email address.' });
    console.error(err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ── GET /api/eventforms/:id/registrations — admin ──────────
router.get('/:id/registrations', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM event_registrations WHERE form_id=$1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch registrations.' });
  }
});

// ── PUT /api/eventforms/registrations/:id/confirm — admin ──
router.put('/registrations/:id/confirm', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE event_registrations SET payment_status='confirmed',
       confirmed_at=NOW(), confirmed_by=$1 WHERE id=$2 RETURNING *`,
      [req.admin.id, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Registration not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to confirm payment.' });
  }
});

// ── DELETE /api/eventforms/registrations/:id — admin ───────
router.delete('/registrations/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM event_registrations WHERE id=$1', [req.params.id]);
    res.json({ message: 'Registration deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete registration.' });
  }
});

module.exports = router;