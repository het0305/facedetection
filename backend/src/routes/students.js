const express = require('express');
const { z } = require('zod');
const config = require('../config');
const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const { requireAdmin } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const validate = require('../middleware/validate');
const enrollment = require('../services/enrollmentService');
const gallery = require('../services/gallery');
const audit = require('../services/audit');
const { encryptDescriptor } = require('../utils/biometricCrypto');
const { badRequest, conflict, notFound } = require('../utils/errors');
const { nameSchema, rollNoSchema, objectId, pageSchema, escapeRegex } = require('./schemas');

const router = express.Router();
router.use(requireAdmin);

const idParams = validate.params(z.object({ id: objectId }));

// poses arrive as a multipart field: JSON array or comma-separated list.
const posesField = z
  .string()
  .max(500)
  .transform((s, ctx) => {
    try {
      const v = s.trim().startsWith('[') ? JSON.parse(s) : s.split(',');
      if (!Array.isArray(v)) throw new Error();
      return v.map((p) => String(p).trim());
    } catch {
      ctx.addIssue({ code: 'custom', message: 'invalid pose list' });
      return z.NEVER;
    }
  });
const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

router.post(
  '/check-sample',
  upload.single('image'),
  validate.body(z.object({ pose: z.enum(enrollment.VALID_POSES).default('front') })),
  async (req, res) => {
    if (!req.file) throw badRequest('NO_IMAGE', 'No camera frame was received.');
    res.json(await enrollment.checkSample(req.file.buffer, req.valid.body.pose));
  }
);

async function samplesWithDuplicateCheck(req, { excludeId, allowDuplicate }) {
  const files = req.files || [];
  const samples = await enrollment.buildSamples(
    files.map((f) => f.buffer),
    req.valid.body.poses
  );
  const similar = await gallery.findSimilar(
    samples.map((s) => s.descriptor),
    config.DUPLICATE_FACE_THRESHOLD,
    { excludeId }
  );
  if (similar.length && !allowDuplicate) {
    throw conflict('DUPLICATE_FACE', 'A similar face is already registered. Please verify before continuing.', {
      matches: similar.slice(0, 3).map((s) => ({ id: s.id, name: s.name, rollNo: s.rollNo, active: s.active })),
    });
  }
  return { samples, similar };
}

const toStored = (samples) =>
  samples.map((s) => ({
    enc: encryptDescriptor(s.descriptor),
    pose: s.pose,
    quality: s.quality,
    liveness: s.liveness ?? undefined,
  }));

router.post(
  '/',
  upload.array('images', config.ENROLL_MAX_SAMPLES),
  validate.body(z.object({ name: nameSchema, rollNo: rollNoSchema, poses: posesField, allowDuplicate: flag })),
  async (req, res) => {
    const { name, rollNo, allowDuplicate } = req.valid.body;
    if (await Student.exists({ rollNo })) throw conflict('ROLLNO_EXISTS', 'This roll number / ID is already registered.');
    const { samples, similar } = await samplesWithDuplicateCheck(req, { allowDuplicate });
    let student;
    try {
      student = await Student.create({ name, rollNo, samples: toStored(samples), sampleCount: samples.length });
    } catch (err) {
      if (err?.code === 11000) throw conflict('ROLLNO_EXISTS', 'This roll number / ID is already registered.');
      throw err;
    }
    await gallery.invalidate();
    const target = { type: 'student', id: String(student._id), label: `${name} (${rollNo})` };
    await audit.record(req, 'student.registered', { target, details: { sampleCount: samples.length } });
    if (similar.length) {
      await audit.record(req, 'student.duplicate_face_override', {
        category: 'security',
        target,
        details: { similarTo: similar.slice(0, 3).map((s) => s.rollNo) },
      });
    }
    res.status(201).json({ message: 'Face registered successfully.', student: student.toJSON() });
  }
);

router.get(
  '/',
  validate.query(
    pageSchema.extend({
      search: z.string().trim().max(100).optional(),
      status: z.enum(['active', 'inactive', 'all']).default('all'),
    })
  ),
  async (req, res) => {
    const { search, status, page, limit } = req.valid.query;
    const filter = {};
    if (status !== 'all') filter.active = status === 'active';
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: rx }, { rollNo: rx }];
    }
    const [items, total] = await Promise.all([
      Student.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Student.countDocuments(filter),
    ]);
    res.json({ items: items.map((s) => s.toJSON()), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }
);

router.get('/duplicates', async (_req, res) => {
  const pairs = await gallery.suspectedDuplicates(config.DUPLICATE_FACE_THRESHOLD);
  res.json({
    threshold: config.DUPLICATE_FACE_THRESHOLD,
    pairs: pairs.map((p) => ({ a: p.a, b: p.b, distance: Math.round(p.distance * 1000) / 1000 })),
  });
});

router.get('/:id', idParams, async (req, res) => {
  const student = await Student.findById(req.valid.params.id);
  if (!student) throw notFound();
  const recent = await Attendance.find({ studentId: student._id }).sort({ checkInAt: -1 }).limit(10);
  res.json({ student: student.toJSON(), recentAttendance: recent.map((r) => r.toJSON()) });
});

router.patch(
  '/:id',
  idParams,
  validate.body(
    z
      .object({ name: nameSchema.optional(), rollNo: rollNoSchema.optional(), active: z.boolean().optional() })
      .strict()
      .refine((b) => Object.keys(b).length > 0, 'nothing to update')
  ),
  async (req, res) => {
    const student = await Student.findById(req.valid.params.id);
    if (!student) throw notFound();
    const before = { name: student.name, rollNo: student.rollNo, active: student.active };
    Object.assign(student, req.valid.body);
    try {
      await student.save();
    } catch (err) {
      if (err?.code === 11000) throw conflict('ROLLNO_EXISTS', 'This roll number / ID is already registered.');
      throw err;
    }
    await gallery.invalidate();
    await audit.record(req, 'student.updated', {
      target: { type: 'student', id: String(student._id), label: `${student.name} (${student.rollNo})` },
      details: { before, after: req.valid.body },
    });
    res.json({ student: student.toJSON() });
  }
);

router.put(
  '/:id/face',
  upload.array('images', config.ENROLL_MAX_SAMPLES),
  idParams,
  validate.body(z.object({ poses: posesField, allowDuplicate: flag })),
  async (req, res) => {
    const student = await Student.findById(req.valid.params.id);
    if (!student) throw notFound();
    const { samples, similar } = await samplesWithDuplicateCheck(req, {
      excludeId: student._id,
      allowDuplicate: req.valid.body.allowDuplicate,
    });
    student.samples = toStored(samples);
    student.sampleCount = samples.length;
    student.hasLegacySample = false;
    await student.save();
    await gallery.invalidate();
    const target = { type: 'student', id: String(student._id), label: `${student.name} (${student.rollNo})` };
    await audit.record(req, 'student.face_replaced', { target, details: { sampleCount: samples.length } });
    if (similar.length) {
      await audit.record(req, 'student.duplicate_face_override', {
        category: 'security',
        target,
        details: { similarTo: similar.slice(0, 3).map((s) => s.rollNo) },
      });
    }
    res.json({ message: 'Face updated successfully.', student: student.toJSON() });
  }
);

router.delete('/:id', idParams, async (req, res) => {
  const student = await Student.findByIdAndDelete(req.valid.params.id);
  if (!student) throw notFound();
  await gallery.invalidate();
  await audit.record(req, 'student.deleted', {
    target: { type: 'student', id: String(student._id), label: `${student.name} (${student.rollNo})` },
  });
  res.json({ ok: true });
});

module.exports = router;
