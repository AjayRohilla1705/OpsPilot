const { logger } = require('../utils/logger');

function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'NotFound', message: `No route for ${req.method} ${req.path}` });
  }
  next();
}

function errorHandler(err, _req, res, _next) {
  logger.error('[error]', err.message, err.stack);
  const status = err.status || 500;
  res.status(status).json({
    error: err.name || 'ServerError',
    message: err.expose ? err.message : (status === 500 ? 'Internal server error' : err.message)
  });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
    this.name = 'HttpError';
  }
}

module.exports = { notFoundHandler, errorHandler, HttpError };
