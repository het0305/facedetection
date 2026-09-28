// Express application (no listening, no DB connection) so tests can use it directly.
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { authenticate, requireAdmin } = require('./middleware/auth');
const { csrfGuard } = require('./middleware/security');
const { apiLimiter } = require('./middleware/rateLimits');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { exportHandler } = require('./routes/attendance');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(helmet());
  if (config.CORS_ORIGINS.length) {
    app.use(cors({ origin: config.CORS_ORIGINS, credentials: true }));
  }
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(apiLimiter);
  api.use(csrfGuard);
  api.use(authenticate);

  api.get('/health', (_req, res) => res.json({ status: 'ok' }));
  api.use('/auth', require('./routes/auth'));
  api.use('/kiosk', require('./routes/kiosk'));
  api.use('/students', require('./routes/students'));
  api.use('/attendance', require('./routes/attendance'));
  api.use('/admin', require('./routes/admin'));

  // Backwards-compatible path used by the original UI; now admin-only and
  // generated from the database (today's records) instead of a static file.
  api.get('/download-attendance', requireAdmin, exportHandler);

  api.use(notFoundHandler);
  app.use('/api', api);

  // Optional: serve the production React build from the same origin.
  const build = path.join(__dirname, '../../frontend/build');
  if (config.SERVE_FRONTEND && fs.existsSync(path.join(build, 'index.html'))) {
    app.use(express.static(build, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(build, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
