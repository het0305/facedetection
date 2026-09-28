const express = require('express');
const ExcelJS = require('exceljs');
const { z } = require('zod');
const config = require('../config');
const Attendance = require('../models/Attendance');
const { requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const audit = require('../services/audit');
const { dayKeyOf } = require('../utils/time');
const { badRequest, notFound } = require('../utils/errors');
const { objectId, dayKey, pageSchema, escapeRegex } = require('./schemas');

const router = express.Router();
router.use(requireAdmin);

const filterSchema = z.object({
  from: dayKey.optional(),
  to: dayKey.optional(),
  studentId: objectId.optional(),
  search: z.string().trim().max(100).optional(),
  status: z.enum(['Present', 'Late']).optional(),
});

function buildFilter(q) {
  if (q.from && q.to && q.from > q.to) throw badRequest('VALIDATION_ERROR', '"From" date must be before "To" date.');
  const filter = {};
  if (q.from || q.to) {
    filter.dayKey = {};
    if (q.from) filter.dayKey.$gte = q.from;
    if (q.to) filter.dayKey.$lte = q.to;
  }
  if (q.studentId) filter.studentId = q.studentId;
  if (q.status) filter.status = q.status;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ studentName: rx }, { rollNo: rx }];
  }
  return filter;
}

router.get('/', validate.query(filterSchema.extend(pageSchema.shape)), async (req, res) => {
  const { page, limit, ...q } = req.valid.query;
  const filter = buildFilter(q);
  const [items, total] = await Promise.all([
    Attendance.find(filter).sort({ checkInAt: -1 }).skip((page - 1) * limit).limit(limit),
    Attendance.countDocuments(filter),
  ]);
  res.json({ items: items.map((r) => r.toJSON()), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

const MAX_EXPORT_ROWS = 50000;

async function exportHandler(req, res) {
  const q = req.valid?.query || { from: dayKeyOf(), to: dayKeyOf() };
  const filter = buildFilter(q);
  const rows = await Attendance.find(filter).sort({ dayKey: 1, checkInAt: 1 }).limit(MAX_EXPORT_ROWS).lean();

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const sheet = wb.addWorksheet('Attendance');
  sheet.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Roll No / ID', key: 'rollNo', width: 18 },
    { header: `Check-in (${config.APP_TIMEZONE})`, key: 'time', width: 22 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Verification', key: 'verification', width: 22 },
    { header: 'Source', key: 'source', width: 10 },
  ];
  sheet.getRow(1).font = { bold: true };
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  for (const r of rows) {
    sheet.addRow({
      date: r.dayKey,
      name: r.studentName,
      rollNo: r.rollNo,
      time: timeFmt.format(r.checkInAt),
      status: r.status,
      verification: r.verification?.confidence
        ? `Face (${r.verification.confidence})${r.verification.liveness != null ? ' + liveness' : ''}`
        : r.source === 'legacy'
          ? 'Legacy record'
          : '',
      source: r.source,
    });
  }
  await audit.record(req, 'attendance.exported', { details: { ...q, rows: rows.length } });
  const name = `attendance_${q.from || 'all'}_${q.to || 'all'}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  await wb.xlsx.write(res);
  res.end();
}

router.get('/export', validate.query(filterSchema), exportHandler);

router.patch(
  '/:id',
  validate.params(z.object({ id: objectId })),
  validate.body(z.object({ status: z.enum(['Present', 'Late']) }).strict()),
  async (req, res) => {
    const record = await Attendance.findById(req.valid.params.id);
    if (!record) throw notFound();
    const before = record.status;
    record.status = req.valid.body.status;
    await record.save();
    await audit.record(req, 'attendance.updated', {
      target: { type: 'attendance', id: String(record._id), label: `${record.studentName} ${record.dayKey}` },
      details: { before: { status: before }, after: { status: record.status } },
    });
    res.json({ record: record.toJSON() });
  }
);

router.delete('/:id', validate.params(z.object({ id: objectId })), async (req, res) => {
  const record = await Attendance.findByIdAndDelete(req.valid.params.id);
  if (!record) throw notFound();
  await audit.record(req, 'attendance.deleted', {
    target: { type: 'attendance', id: String(record._id), label: `${record.studentName} ${record.dayKey}` },
    details: { rollNo: record.rollNo, dayKey: record.dayKey, status: record.status },
  });
  res.json({ ok: true });
});

module.exports = router;
module.exports.exportHandler = exportHandler;
