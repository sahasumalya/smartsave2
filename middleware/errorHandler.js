const { error: logError } = require('../utils/logger');

/**
 * Central exception handler.
 * Any error passed to next(err) from route handlers (or from asyncHandler)
 * is caught here and returns 500 Internal Server Error.
 * The server continues running. Logs error message/stack only (no request body).
 */
function errorHandler(err, req, res, next) {
  logError('handler', err.stack || err.message || err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    status: 'error',
    message: 'Internal server error.',
  });
}

module.exports = { errorHandler };
