// ============================================================
// CLOUDINARY + MULTER UPLOAD MIDDLEWARE
// Lighthouse Church — The Quodesh Family Church
//
// HOW IT WORKS:
//   1. multer receives the file from the HTTP request (in memory)
//   2. cloudinary.uploader.upload_stream() sends it to Cloudinary
//   3. Cloudinary stores it and returns { secure_url, public_id }
//   4. The route saves secure_url → image_url/audio_url/video_url
//      and public_id → cloudinary_public_id (for future delete/replace)
//
// SETUP:
//   npm install cloudinary multer
//   Add to .env:
//     CLOUDINARY_CLOUD_NAME=your_cloud_name
//     CLOUDINARY_API_KEY=your_api_key
//     CLOUDINARY_API_SECRET=your_api_secret
// ============================================================

const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

// ── Configure Cloudinary ────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true, // always use https
});

// ── Multer: store files in memory (never touch the disk) ────
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = {
    image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    video: ['video/mp4', 'video/mov', 'video/avi', 'video/mkv', 'video/webm'],
    audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/m4a'],
  };
  const allAllowed = [...allowed.image, ...allowed.video, ...allowed.audio];
  if (allAllowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed.`), false);
  }
};

// Max sizes:  images 10MB · audio 100MB · video 500MB
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB hard cap (Cloudinary limits apply too)
});

// ── Helper: buffer → readable stream ───────────────────────
function bufferToStream(buffer) {
  const readable = new Readable();
  readable.push(buffer);
  readable.push(null);
  return readable;
}

// ── Core upload function ────────────────────────────────────
// folder   → Cloudinary folder, e.g. 'lighthouse/gallery'
// options  → extra Cloudinary options (resource_type, transformation, etc.)
// Returns  → { secure_url, public_id }
async function uploadToCloudinary(fileBuffer, folder, options = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        use_filename: false,
        unique_filename: true,
        overwrite: false,
        ...options,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      }
    );
    bufferToStream(fileBuffer).pipe(uploadStream);
  });
}

// ── Delete from Cloudinary ──────────────────────────────────
// Call this before deleting a DB row that has a cloudinary_public_id
// resource_type: 'image' | 'video' | 'raw' (audio = 'video' in Cloudinary)
async function deleteFromCloudinary(publicId, resource_type = 'image') {
  if (!publicId) return; // no-op if nothing stored
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type });
  } catch (err) {
    // Log but don't throw — DB delete should still succeed even if CDN delete fails
    console.error(`Cloudinary delete failed for ${publicId}:`, err.message);
  }
}

// ── Convenience upload functions per resource type ──────────

async function uploadImage(fileBuffer, folder = 'lighthouse/images') {
  return uploadToCloudinary(fileBuffer, folder, {
    resource_type: 'image',
    transformation: [
      { quality: 'auto:good' }, // auto-compress
      { fetch_format: 'auto' }, // serve webp/avif when browser supports it
    ],
  });
}

async function uploadAudio(fileBuffer, folder = 'lighthouse/sermons/audio') {
  return uploadToCloudinary(fileBuffer, folder, {
    resource_type: 'video', // Cloudinary uses 'video' for audio too
  });
}

async function uploadVideo(fileBuffer, folder = 'lighthouse/sermons/video') {
  return uploadToCloudinary(fileBuffer, folder, {
    resource_type: 'video',
  });
}

// ── multer field configs (used in routes) ──────────────────
//
// Single image:   upload.single('image')
// Multiple files: upload.fields([{ name:'audio', maxCount:1 }, { name:'thumbnail', maxCount:1 }])

module.exports = {
  upload,           // multer instance — use as route middleware
  uploadImage,
  uploadAudio,
  uploadVideo,
  deleteFromCloudinary,
};