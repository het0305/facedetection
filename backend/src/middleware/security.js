// CSRF defence in depth on top of SameSite=Strict cookies: state-changing
// requests must carry a custom header (which cross-site forms cannot set
// without a CORS preflight) and, when present, an allowed Origin.
const config = require('../config');
const { forbidden } = require('../utils/errors');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfGuard(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  if (req.get('x-requested-with') !== 'XMLHttpRequest') return next(forbidden('Request blocked.'));
  const origin = req.get('origin');
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return next(forbidden('Request blocked.'));
    }
    const sameHost = host === req.get('host');
    if (!sameHost && !config.CORS_ORIGINS.includes(origin)) return next(forbidden('Request blocked.'));
  }
  next();
}

module.exports = { csrfGuard };
