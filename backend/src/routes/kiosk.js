const express = require('express');
const { z } = require('zod');
const { requireKioskOrAdmin } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { scanLimiter } = require('../middleware/rateLimits');
const validate = require('../middleware/validate');
const { analyzeFrame } = require('../services/faceAnalysis');
const { SessionStore } = require('../services/scanSession');
const gallery = require('../services/gallery');
const attendanceService = require('../services/attendanceService');
const audit = require('../services/audit');
const Device = require('../models/Device');
const logger = require('../utils/logger');
const { badRequest, conflict } = require('../utils/errors');

const router = express.Router();
const store = new SessionStore();

router.use(requireKioskOrAdmin);

const scanSchema = z.object({ sessionId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)) });

router.post('/scan', scanLimiter, upload.single('image'), validate.body(scanSchema), async (req, res) => {
  if (!req.file) throw badRequest('NO_IMAGE', 'No camera frame was received.');
  const owner = req.device ? `device:${req.device._id}` : `admin:${req.admin._id}`;
  let session = store.get(req.valid.body.sessionId, owner);
  if (!session || session.phase === 'DONE') {
    session = store.create({
      owner,
      deviceId: req.device?._id,
      deps: {
        match: (d) => gallery.match(d),
        mark: (args) => attendanceService.markAttendance(args),
        onSecurityEvent: (action, details) => audit.record(req, action, { category: 'security', details }),
        onError: (err) => logger.error('Attendance write failed', { err }),
      },
    });
  }
  if (session.busy) throw conflict('BUSY', 'Still processing the previous frame.');
  session.busy = true;
  try {
    const analysis = await analyzeFrame(req.file.buffer, session.analysisOptions());
    const out = await session.step(analysis);
    if (out.terminal && ['MARKED', 'ALREADY_MARKED'].includes(out.state)) {
      logger.info('Attendance scan completed', { state: out.state, rollNo: out.result?.rollNo });
    } else if (out.terminal) {
      logger.info('Attendance scan ended', { state: out.state });
    }
    res.json(out);
  } finally {
    session.busy = false;
  }
  if (req.device && (!req.device.lastSeenAt || Date.now() - req.device.lastSeenAt > 60000)) {
    Device.updateOne({ _id: req.device._id }, { lastSeenAt: new Date() }).catch(() => {});
  }
});

module.exports = router;
