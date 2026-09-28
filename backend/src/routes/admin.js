// Dashboard, devices, audit trail and system status (all admin-only).
const express = require('express');
const { z } = require('zod');
const config = require('../config');
const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const Device = require('../models/Device');
const AuditLog = require('../models/AuditLog');
const { requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const audit = require('../services/audit');
const engine = require('../services/faceEngine');
const liveness = require('../services/liveness');
const gallery = require('../services/gallery');
const { dayKeyOf } = require('../utils/time');
const { notFound } = require('../utils/errors');
const { objectId, pageSchema } = require('./schemas');

const router = express.Router();
router.use(requireAdmin);

router.get('/dashboard', async (_req, res) => {
  const today = dayKeyOf();
  const weekAgo = dayKeyOf(new Date(Date.now() - 6 * 86400000));
  const [totalActive, totalRegistered, todayCounts, recent, week, needsReenroll] = await Promise.all([
    Student.countDocuments({ active: true }),
    Student.countDocuments({}),
    Attendance.aggregate([{ $match: { dayKey: today } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Attendance.find({ dayKey: today }).sort({ checkInAt: -1 }).limit(10),
    Attendance.aggregate([
      { $match: { dayKey: { $gte: weekAgo, $lte: today } } },
      { $group: { _id: '$dayKey', n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Student.countDocuments({ active: true, $or: [{ hasLegacySample: true }, { sampleCount: { $lt: config.ENROLL_MIN_SAMPLES } }] }),
  ]);
  const byStatus = Object.fromEntries(todayCounts.map((c) => [c._id, c.n]));
  const present = (byStatus.Present || 0) + (byStatus.Late || 0);
  res.json({
    today,
    timezone: config.APP_TIMEZONE,
    totalActive,
    totalRegistered,
    present,
    late: byStatus.Late || 0,
    absent: Math.max(0, totalActive - present),
    needsReenroll,
    recent: recent.map((r) => r.toJSON()),
    week: week.map((w) => ({ dayKey: w._id, count: w.n })),
  });
});

router.get('/devices', async (_req, res) => {
  const devices = await Device.find().sort({ createdAt: -1 }).limit(200);
  res.json({ items: devices.map((d) => d.toJSON()) });
});

router.patch(
  '/devices/:id',
  validate.params(z.object({ id: objectId })),
  validate.body(z.object({ active: z.boolean() }).strict()),
  async (req, res) => {
    const device = await Device.findByIdAndUpdate(req.valid.params.id, { active: req.valid.body.active }, { new: true });
    if (!device) throw notFound();
    await audit.record(req, device.active ? 'kiosk.reactivated' : 'kiosk.revoked', {
      target: { type: 'device', id: String(device._id), label: device.name },
    });
    res.json({ device: device.toJSON() });
  }
);

router.get(
  '/audit',
  validate.query(pageSchema.extend({ category: z.enum(['admin', 'auth', 'security', 'system']).optional() })),
  async (req, res) => {
    const { page, limit, category } = req.valid.query;
    const filter = category ? { category } : {};
    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }
);

router.get('/system', (_req, res) => {
  res.json({
    engine: engine.status(),
    liveness: liveness.status(),
    galleryIdentities: gallery.size(),
    timezone: config.APP_TIMEZONE,
    lateAfter: config.LATE_AFTER || null,
    recognition: {
      threshold: config.RECOGNITION_THRESHOLD,
      highConfidenceThreshold: config.HIGH_CONFIDENCE_THRESHOLD,
      minMargin: config.RECOGNITION_MIN_MARGIN,
      strategy: config.MATCH_STRATEGY,
      stableFrames: config.STABLE_FRAMES,
      duplicateThreshold: config.DUPLICATE_FACE_THRESHOLD,
    },
    livenessThreshold: config.LIVENESS_THRESHOLD,
  });
});

module.exports = router;
