// Users only ever see safe messages. Internal errors are logged with a request
// id that is also returned, so support can find the log line without the
// client seeing stack traces or implementation details.
const crypto = require('crypto');
const multer = require('multer');
const logger = require('../utils/logger');

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: 'The image is too large.',
  LIMIT_FILE_COUNT: 'Too many images were uploaded.',
  LIMIT_UNEXPECTED_FILE: 'Unexpected upload field.',
};

// Express identifies error handlers by arity, so all four parameters are required.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res
      .status(status)
      .json({ error: { code: err.code, message: MULTER_MESSAGES[err.code] || 'Invalid upload.' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request is too large.' } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Invalid request.' } });
  }
  if (err?.expose && err.status < 500) {
    const body = { code: err.code, message: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json({ error: body });
  }
  const requestId = crypto.randomUUID();
  logger.error('Unhandled error', { requestId, method: req.method, path: req.path, err });
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.', requestId },
  });
}

function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
}

module.exports = { errorHandler, notFoundHandler };
