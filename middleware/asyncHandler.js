/**
 * Wraps async route handlers so that any thrown error or rejected promise
 * is passed to next(err), allowing the global error handler to return 500.
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
