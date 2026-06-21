# Lighthouse Church — Backend API

Express + PostgreSQL (Supabase) backend for Lighthouse Church's website and admin dashboard. Deployed on **Render**.

## Stack

- Node.js / Express
- PostgreSQL via Supabase (connection pooled with `pg`)
- Cloudinary for image/audio/video storage
- JWT auth (Bearer tokens) for the admin dashboard
- Helmet, CORS allowlist, and route-level rate limiting

## Local Development

```bash
npm install
cp .env.example .env   # fill in real values
npm run dev             # nodemon, restarts on file changes
```

Server runs at `http://localhost:5000`. The frontend (both public site and admin dashboard) auto-detects `localhost` and points at this URL — no extra config needed for local dev.

## Environment Variables

All required — the app **fails fast on startup** if any are missing (see top of `server.js`).

| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase Postgres connection string (use the **pooler** URL, not direct) |
| `JWT_SECRET` | Random string, **32+ characters**. Used to sign admin login tokens. |
| `CLOUDINARY_CLOUD_NAME` | From Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | From Cloudinary dashboard |
| `CLOUDINARY_API_SECRET` | From Cloudinary dashboard — keep secret, never log or commit |
| `FRONTEND_URL` | The deployed Vercel frontend URL, e.g. `https://lighthouse-church.vercel.app` (no trailing slash). Required for CORS to allow the live frontend to call this API. |
| `NODE_ENV` | `production` on Render, unset/`development` locally |
| `PORT` | Optional, defaults to `5000` |

> ⚠️ `.env` is git-ignored. Never commit it. If it's ever accidentally committed, rotate `JWT_SECRET`, `CLOUDINARY_API_SECRET`, and the Supabase DB password immediately — deleting the file later does not undo exposure already in git history.

## Deploying to Render

1. Push this repo to GitHub.
2. New Web Service on Render → connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add all environment variables above in the Render dashboard (Settings → Environment).
6. Set `FRONTEND_URL` to your **exact** live Vercel domain — mismatches here cause CORS errors on the deployed frontend even though everything works locally.
7. Deploy. Check `https://your-app.onrender.com/api/health` returns `{ "status": "ok" }`.

## Security Notes (read before changing auth/upload code)

- **Passwords**: bcrypt, cost factor 12. Never lower this.
- **JWT**: signed and verified with `JWT_SECRET`, 8h expiry. Verified in `middleware/auth.js` on every protected route.
- **CORS**: explicit allowlist in `server.js` (`allowedOrigins`). Do not switch this to `origin: '*'` — Bearer-token auth combined with wildcard CORS is unsafe.
- **Rate limiting**: global cap on `/api/*`, tighter limits on `/api/auth/login` (brute-force protection) and on public unauthenticated POSTs (`/prayer`, `/contact`, `/eventforms/.../register`).
- **File uploads**: `multer.memoryStorage()` — files never touch disk. Every route that accepts a file calls `validateFileSize()` (in `middleware/upload.js`) before uploading to Cloudinary. Limits: images 10MB, audio 100MB, video 500MB (ministry videos capped tighter at 50MB in `routes/upload.js`).
- **SQL**: all queries are parameterized (`$1, $2...`). Never string-concatenate user input into a query.
- **Errors**: in production, the global error handler hides stack traces and returns a generic message. Don't `console.log` secrets or full error objects in routes.
- **Admin XSS**: public-facing form fields (prayer requests, contact messages) are rendered in the dashboard with `esc()` before being inserted via `innerHTML`. Any new public-input field rendered in the dashboard must follow the same pattern.

## Project Structure

```
routes/         — one file per resource (members, sermons, gallery, etc.)
middleware/     — auth.js (JWT verify), upload.js (Cloudinary + multer + size limits)
db/pool.js      — Postgres connection pool
server.js       — entry point: security headers, CORS, rate limits, route mounting
```

## Known Background Job

`runAutoArchive()` runs on startup and every 24h (auto-archives expired events). If you see `[auto-archive] Failed: Connection terminated due to connection timeout` in logs, it's a transient DB connectivity blip, not a security issue — it's caught and logged, and will simply succeed on the next scheduled run.