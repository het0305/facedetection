// Cookie-based authentication.
//   fa_session  admin session (JWT, audience "admin", revocable via tokenVersion)
//   fa_kiosk    kiosk device token (JWT, audience "kiosk", revocable per device)
// Both cookies are httpOnly + SameSite=Strict, so page scripts cannot read
// them and other sites cannot send them.
const jwt = require('jsonwebtoken');
const config = require('../config');
const Admin = require('../models/Admin');
const Device = require('../models/Device');
const { unauthorized, forbidden } = require('../utils/errors');

const ISSUER = 'face-attendance';
const ADMIN_COOKIE = 'fa_session';
const KIOSK_COOKIE = 'fa_kiosk';

const cookieOptions = (maxAgeMs) => ({
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'strict',
  path: '/api',
  ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
});

function issueAdminSession(res, admin) {
  const token = jwt.sign({ tv: admin.tokenVersion }, config.JWT_SECRET, {
    subject: String(admin._id),
    audience: 'admin',
    issuer: ISSUER,
    expiresIn: config.ADMIN_SESSION_HOURS * 3600,
  });
  res.cookie(ADMIN_COOKIE, token, cookieOptions(config.ADMIN_SESSION_HOURS * 3600 * 1000));
}

function issueKioskToken(res, device) {
  const token = jwt.sign({}, config.JWT_SECRET, {
    subject: String(device._id),
    audience: 'kiosk',
    issuer: ISSUER,
    expiresIn: config.KIOSK_SESSION_DAYS * 86400,
  });
  res.cookie(KIOSK_COOKIE, token, cookieOptions(config.KIOSK_SESSION_DAYS * 86400 * 1000));
}

const clearAdminSession = (res) => res.clearCookie(ADMIN_COOKIE, cookieOptions());
const clearKioskToken = (res) => res.clearCookie(KIOSK_COOKIE, cookieOptions());

function verify(token, audience) {
  try {
    return jwt.verify(token, config.JWT_SECRET, { audience, issuer: ISSUER, algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

/** Populates req.admin / req.device when valid cookies are present. Never rejects. */
async function authenticate(req, _res, next) {
  const adminToken = req.cookies?.[ADMIN_COOKIE];
  if (typeof adminToken === 'string') {
    const claims = verify(adminToken, 'admin');
    if (claims) {
      const admin = await Admin.findById(claims.sub).select('+tokenVersion');
      if (admin && admin.active && admin.tokenVersion === claims.tv) req.admin = admin;
    }
  }
  const kioskToken = req.cookies?.[KIOSK_COOKIE];
  if (typeof kioskToken === 'string') {
    const claims = verify(kioskToken, 'kiosk');
    if (claims) {
      const device = await Device.findById(claims.sub);
      if (device && device.active) req.device = device;
    }
  }
  next();
}

function requireAdmin(req, _res, next) {
  if (!req.admin) return next(unauthorized());
  if (req.admin.role !== 'admin') return next(forbidden());
  next();
}

function requireKioskOrAdmin(req, _res, next) {
  if (req.device || req.admin) return next();
  next(unauthorized('This device is not activated for attendance. Ask an administrator to activate it.'));
}

module.exports = {
  authenticate,
  requireAdmin,
  requireKioskOrAdmin,
  issueAdminSession,
  issueKioskToken,
  clearAdminSession,
  clearKioskToken,
};
