const express = require('express');
const { upload, uploadImage, deleteFromCloudinary } = require('../middleware/upload');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// POST /api/upload/image — authenticated, uploads a single image to Cloudinary
// Body: multipart/form-data with field 'image' and optional 'folder'
router.post('/image', authenticate, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided.' });

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

module.exports = router;