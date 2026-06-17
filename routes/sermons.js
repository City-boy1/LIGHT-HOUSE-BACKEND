// ============================================================
// SERMONS ROUTES — /api/sermons
// Lighthouse Church — The Quodesh Family Church
//
// Supports:
//   • Upload audio file → Cloudinary
//   • Upload video file → Cloudinary (or paste YouTube URL)
//   • Upload thumbnail → Cloudinary
//   • OR paste any URL (backwards compatible)
//   • Archive sermon (hide from public, keep files)
//   • Delete (removes DB row + all Cloudinary files for that sermon)
// ============================================================

const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { upload, uploadImage, uploadAudio, uploadVideo, deleteFromCloudinary } = require('../middleware/upload');
const router = express.Router();

// multer field config for sermons: audio + video + thumbnail in one request
const sermonUpload = upload.fields([
  { name: 'audio',     maxCount: 1 },
  { name: 'video',     maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]);

// ── GET /api/sermons — public ───────────────────────────────
router.get('/', async (req, res) => {
  const { series, pastor_id } = req.query;
  let query = `
    SELECT s.*, p.name AS pastor_name
    FROM sermons s
    LEFT JOIN pastors p ON s.pastor_id = p.id
    WHERE s.is_published = true AND s.is_archived = false
  `;
  const params = [];
  if (series)    { params.push(series);    query += ` AND s.series_name = $${params.length}`; }
  if (pastor_id) { params.push(pastor_id); query += ` AND s.pastor_id = $${params.length}`; }
  query += ' ORDER BY s.sermon_date DESC LIMIT 100';

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Sermons fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch sermons.' });
  }
});

// ── GET /api/sermons/all — admin ────────────────────────────
router.get('/all', authenticate, async (req, res) => {
  const { archived } = req.query;
  let query = `
    SELECT s.*, p.name AS pastor_name
    FROM sermons s
    LEFT JOIN pastors p ON s.pastor_id = p.id
    WHERE 1=1
  `;
  if (archived === 'true')  query += ' AND s.is_archived = true';
  if (archived === 'false') query += ' AND s.is_archived = false';
  query += ' ORDER BY s.sermon_date DESC';

  try {
    const result = await pool.query(query, []);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sermons.' });
  }
});

// ── GET /api/sermons/:id — public ──────────────────────────
router.get('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE sermons SET views = views + 1 WHERE id = $1', [req.params.id]);
    const result = await pool.query(
      `SELECT s.*, p.name AS pastor_name
       FROM sermons s
       LEFT JOIN pastors p ON s.pastor_id = p.id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Sermon not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sermon.' });
  }
});

// ── POST /api/sermons — admin ───────────────────────────────
// Accepts multipart/form-data (file fields: audio, video, thumbnail)
// AND/OR plain URL text fields (audio_url, video_url, thumbnail_url)
router.post('/', authenticate, sermonUpload, async (req, res) => {
  const {
    title, pastor_id, scripture_reference, description,
    audio_url, video_url, thumbnail_url,
    series_name, sermon_date, duration_minutes,
  } = req.body;

  if (!title || !sermon_date) {
    return res.status(400).json({ error: 'Title and sermon date are required.' });
  }

  let finalAudioUrl    = audio_url    || null;
  let finalVideoUrl    = video_url    || null;
  let finalThumbnailUrl = thumbnail_url || null;
  let audioCloudId     = null;
  let videoCloudId     = null;
  let thumbnailCloudId = null;

  try {
    // Upload audio if provided
    if (req.files?.audio?.[0]) {
      const r = await uploadAudio(req.files.audio[0].buffer, 'lighthouse/sermons/audio');
      finalAudioUrl = r.secure_url;
      audioCloudId  = r.public_id;
    }

    // Upload video if provided (ignores if video_url is a YouTube link instead)
    if (req.files?.video?.[0]) {
      const r = await uploadVideo(req.files.video[0].buffer, 'lighthouse/sermons/video');
      finalVideoUrl = r.secure_url;
      videoCloudId  = r.public_id;
    }

    // Upload thumbnail if provided
    if (req.files?.thumbnail?.[0]) {
      const r = await uploadImage(req.files.thumbnail[0].buffer, 'lighthouse/sermons/thumbnails');
      finalThumbnailUrl = r.secure_url;
      thumbnailCloudId  = r.public_id;
    }
  } catch (err) {
    console.error('Cloudinary upload error (sermon):', err);
    // Clean up any partial uploads
    if (audioCloudId)     await deleteFromCloudinary(audioCloudId, 'video');
    if (videoCloudId)     await deleteFromCloudinary(videoCloudId, 'video');
    if (thumbnailCloudId) await deleteFromCloudinary(thumbnailCloudId, 'image');
    return res.status(500).json({ error: 'File upload failed. Please try again.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO sermons
         (title, pastor_id, scripture_reference, description,
          audio_url, audio_cloudinary_id,
          video_url, video_cloudinary_id,
          thumbnail_url, thumbnail_cloudinary_id,
          series_name, sermon_date, duration_minutes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        title, pastor_id || null, scripture_reference || null, description || null,
        finalAudioUrl, audioCloudId,
        finalVideoUrl, videoCloudId,
        finalThumbnailUrl, thumbnailCloudId,
        series_name || null, sermon_date, duration_minutes || null,
        req.admin.id,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Sermon insert error:', err);
    // DB failed — clean up Cloudinary files we already uploaded
    if (audioCloudId)     await deleteFromCloudinary(audioCloudId, 'video');
    if (videoCloudId)     await deleteFromCloudinary(videoCloudId, 'video');
    if (thumbnailCloudId) await deleteFromCloudinary(thumbnailCloudId, 'image');
    res.status(500).json({ error: 'Failed to save sermon.' });
  }
});

// ── PUT /api/sermons/:id — admin ────────────────────────────
router.put('/:id', authenticate, sermonUpload, async (req, res) => {
  const { id } = req.params;
  const {
    title, pastor_id, scripture_reference, description,
    audio_url, video_url, thumbnail_url,
    series_name, sermon_date, duration_minutes,
    is_published, is_archived,
  } = req.body;

  try {
    const existing = await pool.query('SELECT * FROM sermons WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Sermon not found.' });
    const s = existing.rows[0];

    let finalAudioUrl     = audio_url     !== undefined ? audio_url     : s.audio_url;
    let finalVideoUrl     = video_url     !== undefined ? video_url     : s.video_url;
    let finalThumbnailUrl = thumbnail_url !== undefined ? thumbnail_url : s.thumbnail_url;
    let audioCloudId      = s.audio_cloudinary_id;
    let videoCloudId      = s.video_cloudinary_id;
    let thumbnailCloudId  = s.thumbnail_cloudinary_id;

    // Replace audio
    if (req.files?.audio?.[0]) {
      const r = await uploadAudio(req.files.audio[0].buffer, 'lighthouse/sermons/audio');
      finalAudioUrl = r.secure_url;
      if (s.audio_cloudinary_id) await deleteFromCloudinary(s.audio_cloudinary_id, 'video');
      audioCloudId = r.public_id;
    }

    // Replace video
    if (req.files?.video?.[0]) {
      const r = await uploadVideo(req.files.video[0].buffer, 'lighthouse/sermons/video');
      finalVideoUrl = r.secure_url;
      if (s.video_cloudinary_id) await deleteFromCloudinary(s.video_cloudinary_id, 'video');
      videoCloudId = r.public_id;
    }

    // Replace thumbnail
    if (req.files?.thumbnail?.[0]) {
      const r = await uploadImage(req.files.thumbnail[0].buffer, 'lighthouse/sermons/thumbnails');
      finalThumbnailUrl = r.secure_url;
      if (s.thumbnail_cloudinary_id) await deleteFromCloudinary(s.thumbnail_cloudinary_id, 'image');
      thumbnailCloudId = r.public_id;
    }

    const result = await pool.query(
      `UPDATE sermons SET
         title = $1, pastor_id = $2, scripture_reference = $3, description = $4,
         audio_url = $5, audio_cloudinary_id = $6,
         video_url = $7, video_cloudinary_id = $8,
         thumbnail_url = $9, thumbnail_cloudinary_id = $10,
         series_name = $11, sermon_date = $12, duration_minutes = $13,
         is_published = $14, is_archived = $15, updated_at = NOW()
       WHERE id = $16
       RETURNING *`,
      [
        title              ?? s.title,
        pastor_id          !== undefined ? pastor_id          : s.pastor_id,
        scripture_reference !== undefined ? scripture_reference : s.scripture_reference,
        description        !== undefined ? description        : s.description,
        finalAudioUrl, audioCloudId,
        finalVideoUrl, videoCloudId,
        finalThumbnailUrl, thumbnailCloudId,
        series_name        !== undefined ? series_name        : s.series_name,
        sermon_date        ?? s.sermon_date,
        duration_minutes   !== undefined ? duration_minutes   : s.duration_minutes,
        is_published       !== undefined ? is_published       : s.is_published,
        is_archived        !== undefined ? is_archived        : s.is_archived,
        id,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Sermon update error:', err);
    res.status(500).json({ error: 'Failed to update sermon.' });
  }
});

// ── DELETE /api/sermons/:id — admin ─────────────────────────
// Deletes DB row + ALL associated Cloudinary files
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const existing = await pool.query(
      `SELECT audio_cloudinary_id, video_cloudinary_id, thumbnail_cloudinary_id
       FROM sermons WHERE id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Sermon not found.' });

    const { audio_cloudinary_id, video_cloudinary_id, thumbnail_cloudinary_id } = existing.rows[0];

    // Delete from DB
    await pool.query('DELETE FROM sermons WHERE id = $1', [req.params.id]);

    // Clean up Cloudinary files (audio and video both use resource_type 'video')
    await deleteFromCloudinary(audio_cloudinary_id,     'video');
    await deleteFromCloudinary(video_cloudinary_id,     'video');
    await deleteFromCloudinary(thumbnail_cloudinary_id, 'image');

    res.json({ message: 'Sermon deleted successfully.' });
  } catch (err) {
    console.error('Sermon delete error:', err);
    res.status(500).json({ error: 'Failed to delete sermon.' });
  }
});

module.exports = router;