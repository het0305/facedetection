const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const config = require('../config');
const Admin = require('../models/Admin');
const Device = require('../models/Device');
const audit = require('../services/audit');
const validate = require('../middleware/validate');
const { loginLimiter } = require('../middleware/rateLimits');
const {
  requireAdmin,
  issueAdminSession,
  issueKioskToken,
  clearAdminSession,
  clearKioskToken,
} = require('../middleware/auth');
const { AppError, badRequest } = require('../utils/errors');

const router = express.Router();

// Compared against when the username does not exist so response timing does
// not reveal which usernames are valid.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(50),
  password: z.string().min(1).max(200),
});

router.post('/login', loginLimiter, validate.body(loginSchema), async (req, res) => {
  const { username, password } = req.valid.body;
  const admin = await Admin.findOne({ username }).select('+passwordHash +tokenVersion +failedLogins');
  if (!admin || !admin.active) {
    await bcrypt.compare(password, DUMMY_HASH);
    await audit.record(req, 'auth.login_failed', { category: 'auth', details: { username, reason: 'unknown_user' } });
    throw invalidCredentials();
  }
  if (admin.lockUntil && admin.lockUntil > new Date()) {
    await audit.record(req, 'auth.login_locked', { category: 'auth', details: { username } });
    throw new AppError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Please try again later.');
  }
  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) {
    admin.failedLogins += 1;
    if (admin.failedLogins >= config.LOGIN_MAX_FAILURES) {
      admin.lockUntil = new Date(Date.now() + config.LOGIN_LOCK_MINUTES * 60000);
      admin.failedLogins = 0;
    }
    await admin.save();
    await audit.record(req, 'auth.login_failed', { category: 'auth', details: { username, reason: 'bad_password' } });
    throw invalidCredentials();
  }
  admin.failedLogins = 0;
  admin.lockUntil = undefined;
  admin.lastLoginAt = new Date();
  await admin.save();
  issueAdminSession(res, admin);
  req.admin = admin;
  await audit.record(req, 'auth.login', { category: 'auth' });
  res.json({ admin: { username: admin.username, role: admin.role } });
});

router.post('/logout', async (req, res) => {
  if (req.admin) {
    // Invalidate every outstanding session token for this account.
    await Admin.updateOne({ _id: req.admin._id }, { $inc: { tokenVersion: 1 } });
    await audit.record(req, 'auth.logout', { category: 'auth' });
  }
  clearAdminSession(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({
    admin: req.admin ? { username: req.admin.username, role: req.admin.role } : null,
    kiosk: req.device ? { id: req.device._id, name: req.device.name } : null,
  });
});

const passwordSchema = z
  .string()
  .min(10, 'must be at least 10 characters')
  .max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), 'must contain letters and numbers');

router.post(
  '/change-password',
  requireAdmin,
  validate.body(z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema })),
  async (req, res) => {
    const { currentPassword, newPassword } = req.valid.body;
    const admin = await Admin.findById(req.admin._id).select('+passwordHash +tokenVersion');
    if (!(await bcrypt.compare(currentPassword, admin.passwordHash))) {
      throw badRequest('INVALID_CREDENTIALS', 'Current password is incorrect.');
    }
    admin.passwordHash = await bcrypt.hash(newPassword, 12);
    admin.tokenVersion += 1;
    await admin.save();
    issueAdminSession(res, admin);
    await audit.record(req, 'auth.password_changed', { category: 'auth' });
    res.json({ ok: true });
  }
);

router.post(
  '/kiosk/activate',
  requireAdmin,
  validate.body(z.object({ name: z.string().trim().min(1).max(60) })),
  async (req, res) => {
    const device = await Device.create({ name: req.valid.body.name, createdBy: req.admin._id });
    issueKioskToken(res, device);
    await audit.record(req, 'kiosk.activated', { target: { type: 'device', id: String(device._id), label: device.name } });
    res.status(201).json({ kiosk: { id: device._id, name: device.name } });
  }
);

router.post('/kiosk/deactivate', async (req, res) => {
  if (req.device) {
    await Device.updateOne({ _id: req.device._id }, { active: false });
    await audit.record(req, 'kiosk.deactivated', {
      target: { type: 'device', id: String(req.device._id), label: req.device.name },
    });
  }
  clearKioskToken(res);
  res.json({ ok: true });
});

module.exports = router;
module.exports.passwordSchema = passwordSchema;
