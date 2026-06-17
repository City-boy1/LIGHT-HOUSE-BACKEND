require('dotenv').config();

// ============================================================
// STARTUP ENV VALIDATION — fail fast if critical vars missing
// ============================================================
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`\n❌ Missing required environment variables: ${missing.join(', ')}`);
  console.error('   Check your .env file and restart.\n');
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('\n❌ JWT_SECRET must be at least 32 characters long.\n');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === 'production';

// ============================================================
// SECURITY HEADERS
// ============================================================
app.use(helmet({
  contentSecurityPolicy: isProd ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://res.cloudinary.com", "https://*.google.com", "https://*.googleapis.com"],
      frameSrc: ["https://www.google.com", "https://www.youtube.com", "https://bible-api.com"],
      connectSrc: ["'self'", "https://bible-api.com"],
    }
  } : false,
  crossOriginEmbedderPolicy: false,
}));

// ============================================================
// CORS — allow all dev origins + production frontend
// ============================================================
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ============================================================
// BODY PARSING
// ============================================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================================
// RATE LIMITING
// ============================================================
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
}));

app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' }
}));

app.use('/api/prayer', (req, res, next) => {
  if (req.method === 'POST' && !req.headers.authorization) {
    return rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 5,
      message: { error: 'Too many prayer requests submitted. Please try again later.' }
    })(req, res, next);
  }
  next();
});

app.use('/api/eventforms', (req, res, next) => {
  if (req.method === 'POST' && req.path.includes('/register') && !req.headers.authorization) {
    return rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 5,
      message: { error: 'Too many registration attempts. Please try again later.' }
    })(req, res, next);
  }
  next();
});

app.use('/api/contact', (req, res, next) => {
  if (req.method === 'POST' && !req.headers.authorization) {
    return rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 5,
      message: { error: 'Too many messages submitted. Please try again later.' }
    })(req, res, next);
  }
  next();
});

// ============================================================
// STATIC FILES
// ============================================================
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============================================================
// API ROUTES
// ============================================================
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/pastors',       require('./routes/pastors'));
app.use('/api/announcements', require('./routes/announcements'));
const eventsRouter = require('./routes/events');
app.use('/api/events', eventsRouter);
app.use('/api/sermons',       require('./routes/sermons'));
app.use('/api/ministries',    require('./routes/ministries'));
app.use('/api/gallery',       require('./routes/gallery'));
app.use('/api/prayer',        require('./routes/prayer'));
app.use('/api/settings',      require('./routes/settings'));
app.use('/api/contact',       require('./routes/contact'));
app.use('/api/members',       require('./routes/members'));
app.use('/api/groups',        require('./routes/groups'));
app.use('/api/upload',        require('./routes/upload'));
app.use('/api/eventforms',    require('./routes/eventforms'));

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    church: 'Lighthouse Church – The Quodesh Family Church',
    env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// 404 HANDLER
// ============================================================
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
  // Don't leak error details in production
  console.error('Server error:', err.message || err);
  const message = isProd ? 'An unexpected error occurred.' : (err.message || 'Server error');
  res.status(err.status || 500).json({ error: message });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, async () => {
  console.log(`\n🕊️  Lighthouse Church API running on port ${PORT}`);
  console.log(`📖  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐  API base: http://localhost:${PORT}/api`);
  console.log(`✅  All systems ready\n`);

  // Run once on startup, then every 24 hours
  await eventsRouter.runAutoArchive();
  setInterval(eventsRouter.runAutoArchive, 24 * 60 * 60 * 1000);
});

module.exports = app;