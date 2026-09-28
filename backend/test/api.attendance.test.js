require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { connectTestDb, mongoAvailable, descriptor } = require('./helpers');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
let app;
let mongoose;
let skip = false;
let student;

test.before(async () => {
  if (!(await mongoAvailable())) {
    skip = 'MongoDB not reachable';
    return;
  }
  mongoose = await connectTestDb();
  const Admin = require('../src/models/Admin');
  const Student = require('../src/models/Student');
  const { encryptDescriptor } = require('../src/utils/biometricCrypto');
  await Admin.create({ username: 'admin', passwordHash: await bcrypt.hash('correct-horse-9', 4) });
  student = await Student.create({
    name: 'Asha Patel',
    rollNo: 'EMP-001',
    samples: [{ enc: encryptDescriptor(descriptor(1)) }],
    sampleCount: 1,
  });
  app = require('../src/app').createApp();
});

test.after(async () => {
  if (mongoose) await mongoose.disconnect();
});

async function login() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').set(XHR).send({ username: 'admin', password: 'correct-horse-9' });
  return agent;
}

test('concurrent check-ins for the same person create exactly one record', async (t) => {
  if (skip) return t.skip(skip);
  const svc = require('../src/services/attendanceService');
  const Attendance = require('../src/models/Attendance');
  svc.clearCooldowns();
  const person = { id: String(student._id), name: student.name, rollNo: student.rollNo };
  const results = await Promise.all(
    Array.from({ length: 10 }, () => {
      svc.clearCooldowns();
      return svc.markAttendance({ student: person, verification: { distance: 0.3, confidence: 'high' } });
    })
  );
  assert.equal(results.filter((r) => r.status === 'MARKED').length, 1);
  assert.equal(results.filter((r) => r.status === 'ALREADY_MARKED').length, 9);
  assert.equal(await Attendance.countDocuments({ studentId: student._id }), 1);

  // Repeated recognition while standing in front of the camera: cooldown answers without a write.
  const again = await svc.markAttendance({ student: person, verification: {} });
  assert.equal(again.status, 'ALREADY_MARKED');
  assert.equal(await Attendance.countDocuments({ studentId: student._id }), 1);
});

test('the database itself rejects a duplicate for the same day', async (t) => {
  if (skip) return t.skip(skip);
  const Attendance = require('../src/models/Attendance');
  const existing = await Attendance.findOne({ studentId: student._id });
  await assert.rejects(
    Attendance.create({
      studentId: student._id,
      studentName: 'x',
      rollNo: 'x',
      dayKey: existing.dayKey,
      checkInAt: new Date(),
    }),
    (err) => err.code === 11000
  );
});

test('next day is a new attendance record; late rule applies in local time', async (t) => {
  if (skip) return t.skip(skip);
  const svc = require('../src/services/attendanceService');
  svc.clearCooldowns();
  const person = { id: String(student._id), name: student.name, rollNo: student.rollNo };
  const r = await svc.markAttendance({ student: person, verification: {}, now: new Date('2030-01-02T04:00:00Z') });
  assert.equal(r.status, 'MARKED');
  assert.equal(r.record.dayKey, '2030-01-02');
});

test('admin can list, filter, paginate, edit, export and delete attendance (audited)', async (t) => {
  if (skip) return t.skip(skip);
  const admin = await login();
  const list = await admin.get('/api/attendance?limit=1&page=1');
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.total, 2);
  assert.equal(list.body.pages, 2);

  const filtered = await admin.get('/api/attendance?from=2030-01-01&to=2030-12-31');
  assert.equal(filtered.body.total, 1);
  const searched = await admin.get('/api/attendance?search=asha');
  assert.equal(searched.body.total, 2);
  const badRange = await admin.get('/api/attendance?from=2030-02-01&to=2030-01-01');
  assert.equal(badRange.status, 400);

  const id = filtered.body.items[0]._id;
  const patched = await admin.patch(`/api/attendance/${id}`).set(XHR).send({ status: 'Late' });
  assert.equal(patched.body.record.status, 'Late');
  const invalid = await admin.patch(`/api/attendance/${id}`).set(XHR).send({ status: 'Absent', extra: 1 });
  assert.equal(invalid.status, 400);

  const exp = await admin
    .get('/api/attendance/export?from=2030-01-01&to=2030-12-31')
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(exp.status, 200);
  assert.match(exp.headers['content-type'], /spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(exp.body);
  const sheet = wb.getWorksheet('Attendance');
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getRow(2).getCell(2).value, 'Asha Patel');

  const del = await admin.delete(`/api/attendance/${id}`).set(XHR);
  assert.equal(del.status, 200);

  const auditRes = await admin.get('/api/admin/audit?limit=50');
  const actions = auditRes.body.items.map((a) => a.action);
  for (const a of ['attendance.updated', 'attendance.exported', 'attendance.deleted', 'auth.login']) {
    assert.ok(actions.includes(a), `audit has ${a}`);
  }
  assert.equal(JSON.stringify(auditRes.body).includes('correct-horse'), false, 'no passwords in audit log');
});

test('dashboard summary counts present/absent for the local day', async (t) => {
  if (skip) return t.skip(skip);
  const admin = await login();
  const res = await admin.get('/api/admin/dashboard');
  assert.equal(res.status, 200);
  assert.equal(res.body.totalActive, 1);
  assert.equal(res.body.present, 1);
  assert.equal(res.body.absent, 0);
  assert.equal(res.body.recent[0].studentName, 'Asha Patel');
});

test('deleting a user keeps attendance history via the name snapshot', async (t) => {
  if (skip) return t.skip(skip);
  const admin = await login();
  const Student = require('../src/models/Student');
  const extra = await Student.create({ name: 'Temp User', rollNo: 'TMP-1', samples: [], sampleCount: 0 });
  const svc = require('../src/services/attendanceService');
  await svc.markAttendance({ student: { id: String(extra._id), name: extra.name, rollNo: extra.rollNo }, verification: {} });
  assert.equal((await admin.delete(`/api/students/${extra._id}`).set(XHR)).status, 200);
  const hist = await admin.get('/api/attendance?search=TMP-1');
  assert.equal(hist.body.total, 1);
  assert.equal(hist.body.items[0].studentName, 'Temp User');
  assert.equal((await admin.get(`/api/students/${extra._id}`)).status, 404);
});

test('student update validates uniqueness and deactivation removes the person from matching', async (t) => {
  if (skip) return t.skip(skip);
  const admin = await login();
  const Student = require('../src/models/Student');
  const gallery = require('../src/services/gallery');
  const other = await Student.create({ name: 'Other Person', rollNo: 'EMP-002', samples: [], sampleCount: 0 });
  const dup = await admin.patch(`/api/students/${other._id}`).set(XHR).send({ rollNo: 'EMP-001' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'ROLLNO_EXISTS');

  await gallery.invalidate();
  assert.equal((await gallery.match(descriptor(1, 0.02, 3))).accepted, true);
  await admin.patch(`/api/students/${student._id}`).set(XHR).send({ active: false });
  assert.equal((await gallery.match(descriptor(1, 0.02, 3))).accepted, false, 'inactive users are not recognized');
  await admin.patch(`/api/students/${student._id}`).set(XHR).send({ active: true });
});

test('legacy data migrates safely and idempotently', async (t) => {
  if (skip) return t.skip(skip);
  const db = mongoose.connection.db;
  const legacyId = new mongoose.Types.ObjectId();
  await db.collection('students').insertOne({ _id: legacyId, name: 'Old Record', rollNo: 'OLD-1', embeddings: Array.from(descriptor(9)) });
  await db.collection('attendances').insertOne({ studentId: legacyId, date: new Date('2025-08-06T18:45:00Z'), status: 'Present' });
  const { runMigrations } = require('../src/migrations');
  await runMigrations();
  await runMigrations();
  const s = await db.collection('students').findOne({ _id: legacyId });
  assert.equal(s.embeddings, undefined, 'plaintext embedding removed');
  assert.equal(s.samples.length, 1);
  assert.equal(s.hasLegacySample, true);
  const { decryptDescriptor } = require('../src/utils/biometricCrypto');
  assert.deepEqual(Array.from(decryptDescriptor(s.samples[0].enc)), Array.from(descriptor(9)));
  const a = await db.collection('attendances').findOne({ studentId: legacyId });
  assert.equal(a.dayKey, '2025-08-07', '18:45 UTC is the next day in Asia/Kolkata');
  assert.equal(a.studentName, 'Old Record');
  assert.equal(a.source, 'legacy');
});
