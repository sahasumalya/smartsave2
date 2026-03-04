/**
 * Central exception handler.
 * Any error passed to next(err) from route handlers (or from asyncHandler)
 * is caught here and returns 500 Internal Server Error.
 * The server continues running.
 */
function errorHandler(err, req, res, next) {
  console.error('[error]', err.stack || err.message || err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    status: 'error',
    message: 'Internal server error.',
  });
}

module.exports = { errorHandler };
