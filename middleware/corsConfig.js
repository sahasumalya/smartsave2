const cors = require('cors');

/**
 * CORS for browser clients (e.g. SPA on localhost calling API on Vercel).
 *
 * - If CORS_ORIGIN is unset or empty: allow any origin (reflects the request's Origin header).
 * - If CORS_ORIGIN is a comma-separated list: only those origins are allowed.
 * - Set CORS_ORIGIN=http://localhost:49411 for a single dev frontend.
 *
 * credentials: true so cookies / Authorization work with fetch(..., { credentials: 'include' }).
 */
function getCorsOptions() {
  const raw = process.env.CORS_ORIGIN;
  let origin;
  if (!raw || !String(raw).trim()) {
    origin = true;
  } else if (String(raw).trim() === '*') {
    origin = true;
  } else {
    const list = String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    origin = list.length === 1 ? list[0] : list;
  }

  return {
    origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    optionsSuccessStatus: 204,
  };
}

const corsMiddleware = cors(getCorsOptions());

module.exports = { corsMiddleware, getCorsOptions };
