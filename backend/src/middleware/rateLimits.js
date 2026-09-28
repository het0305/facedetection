const { rateLimit } = require('express-rate-limit');
const config = require('../config');

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit: config.NODE_ENV === 'test' ? 10000 : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message } }),
  });

module.exports = {
  loginLimiter: make(15 * 60 * 1000, 20, 'Too many sign-in attempts. Please wait a few minutes and try again.'),
  // A kiosk sends roughly 3-5 frames per second.
  scanLimiter: make(60 * 1000, 600, 'Too many requests. Please slow down.'),
  apiLimiter: make(60 * 1000, 600, 'Too many requests. Please slow down.'),
};
