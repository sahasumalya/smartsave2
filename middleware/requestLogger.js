const { debug, maskObject, maskHeaders, isDebug } = require('../utils/logger');

/**
 * Logs incoming request (method, path, masked body/query) and response status.
 * Only logs when LOG_LEVEL=debug or DEBUG=1. Sensitive fields are masked.
 */
function requestLogger(req, res, next) {
  if (!isDebug()) return next();

  const start = Date.now();
  const method = req.method;
  const path = req.path || req.url?.split('?')[0];

  const meta = {
    method,
    path,
    query: Object.keys(req.query || {}).length ? maskObject(req.query) : undefined,
    body: req.body && Object.keys(req.body).length ? maskObject(req.body) : undefined,
    headers: maskHeaders(req.headers),
  };
  debug('request', meta);

  res.on('finish', () => {
    const duration = Date.now() - start;
    debug('response', { method, path, statusCode: res.statusCode, durationMs: duration });
  });

  next();
}

module.exports = { requestLogger };
