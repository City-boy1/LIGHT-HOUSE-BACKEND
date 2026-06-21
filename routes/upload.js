const express = require('express');
const { upload, uploadImage, deleteFromCloudinary, validateFileSize } = require('../middleware/upload');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// POST /api/upload/image — authenticated, uploads a single image to Cloudinary
// Body: multipart/form-data with field 'image' and optional 'folder'
router.post('/image', authenticate, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided.' });

  try {
    validateFileSize(req.file);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const folder = req.body.folder || 'lighthouse/images';
    const result = await uploadImage(req.file.buffer, folder);
    res.json({
      url: result.secure_url,
      public_id: result.public_id
    });
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    res.status(500).json({ error: 'Failed to upload image.' });
  }
});

// DELETE /api/upload/image — delete an image from Cloudinary by public_id
router.delete('/image', authenticate, async (req, res) => {
  const { public_id } = req.body;
  if (!public_id) return res.status(400).json({ error: 'public_id required.' });

  try {
    await deleteFromCloudinary(public_id, 'image');
    res.json({ message: 'Image deleted from Cloudinary.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete image.' });
  }
});

// POST /api/upload/video — upload short video to Cloudinary
router.post('/video', authenticate, upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file provided.' });

  // Free tier guard — 50MB max for ministry videos
  if (req.file.size > 50 * 1024 * 1024) {
    return res.status(400).json({ error: 'Video too large. Maximum size is 50MB.' });
  }

  try {
    const folder = req.body.folder || 'lighthouse/ministries/video';
    const { uploadVideo } = require('../middleware/upload');
    const result = await uploadVideo(req.file.buffer, folder);
    res.json({ url: result.secure_url, public_id: result.public_id });
  } catch (err) {
    console.error('Cloudinary video upload error:', err);
    res.status(500).json({ error: 'Failed to upload video. Check file size.' });
  }
});

// DELETE /api/upload/video
router.delete('/video', authenticate, async (req, res) => {
  const { public_id } = req.body;
  if (!public_id) return res.status(400).json({ error: 'public_id required.' });
  try {
    await deleteFromCloudinary(public_id, 'video');
    res.json({ message: 'Video deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete video.' });
  }
});

module.exports = router;