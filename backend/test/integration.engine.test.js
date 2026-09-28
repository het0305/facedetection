// End-to-end with the real models. Needs local face photos of ONE person
// (FACE_TEST_DIR, defaults to backend/uploads) and MongoDB; skipped otherwise.
require('./helpers');
process.env.CHALLENGE_ENABLED = 'false'; // still images cannot perform a head turn
process.env.ENROLL_MIN_SAMPLES = '3';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jpeg = require('jpeg-js');
const { connectTestDb, mongoAvailable, localFaceImages } = require('./helpers');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const images = localFaceImages();
let app;
let mongoose;
let skip = false;

test.before(async () => {
  if (images.length < 4) skip = 'needs >= 4 local face images (FACE_TEST_DIR)';
  else if (!(await mongoAvailable())) skip = 'MongoDB not reachable';
  if (skip) return;
  mongoose = await connectTestDb();
  await require('../src/services/faceEngine').init();
  await require('../src/services/liveness').init();
  const Admin = require('../src/models/Admin');
  await Admin.create({ username: 'admin', passwordHash: await bcrypt.hash('correct-horse-9', 4) });
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

function noiseJpeg(w = 320, h = 240) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < data.length; i += 1) data[i] = (i * 2654435761) % 251;
  return jpeg.encode({ data, width: w, height: h }, 80).data;
}

test('no-face image gives a friendly answer, not an error', async (t) => {
  if (skip) return t.skip(skip);
  const admin = await login();
  const res = await admin.post('/api/students/check-sample').set(XHR).attach('image', noiseJpeg(), 'n.jpg');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'NO_FACE');
});

test('check-sample accepts a good frontal photo', async (t) => {
  if (skip) return t.skip(skip);
  const admin = await login();
  const res = await admin.post('/api/students/check-sample').set(XHR).field('pose', 'front').attach('image', images[0]);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true, res.body.message);
  // Asking for a left turn with a frontal photo must be refused.
  const left = await admin.post('/api/students/check-sample').set(XHR).field('pose', 'left').attach('image', images[0]);
  assert.equal(left.body.ok, false);
});

test('registration -> duplicate detection -> kiosk recognition -> no duplicate attendance', async (t) => {
  if (skip) return t.skip(skip);
  const admin = await login();
  const enroll = images.slice(0, 3);
  const probes = images.slice(3);

  let req = admin.post('/api/students').set(XHR).field('name', 'Test Person').field('rollNo', 'T-100').field('poses', 'front,front,front');
  for (const f of enroll) req = req.attach('images', f);
  const created = await req;
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(JSON.stringify(created.body).includes('samples'), false);

  // Same face under a new ID is flagged.
  let dupReq = admin.post('/api/students').set(XHR).field('name', 'Same Face').field('rollNo', 'T-101').field('poses', 'front,front,front');
  for (const f of enroll) dupReq = dupReq.attach('images', f);
  const dup = await dupReq;
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'DUPLICATE_FACE');
  assert.equal(dup.body.error.details.matches[0].rollNo, 'T-100');

  // Kiosk: feed probe frames (not used for enrollment) until terminal.
  let sessionId = '';
  let out;
  for (let i = 0; i < 12; i += 1) {
    const res = await admin
      .post('/api/kiosk/scan')
      .set(XHR)
      .field('sessionId', sessionId)
      .attach('image', probes[i % probes.length]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    out = res.body;
    sessionId = out.sessionId;
    if (out.terminal) break;
  }
  assert.equal(out.state, 'MARKED', JSON.stringify(out));
  assert.equal(out.result.rollNo, 'T-100');

  // A second full session the same day must not create another record.
  sessionId = '';
  for (let i = 0; i < 12; i += 1) {
    const res = await admin.post('/api/kiosk/scan').set(XHR).field('sessionId', sessionId).attach('image', probes[i % probes.length]);
    out = res.body;
    sessionId = out.sessionId;
    if (out.terminal) break;
  }
  assert.equal(out.state, 'ALREADY_MARKED');
  const Attendance = require('../src/models/Attendance');
  assert.equal(await Attendance.countDocuments({ rollNo: 'T-100' }), 1);
  const rec = await Attendance.findOne({ rollNo: 'T-100' }).lean();
  assert.ok(rec.verification.distance < 0.5);
  assert.ok(rec.verification.liveness > 0);
});

test('unregistered face is not recognized', async (t) => {
  if (skip) return t.skip(skip);
  const admin = await login();
  const Student = require('../src/models/Student');
  await Student.updateMany({}, { active: false });
  await require('../src/services/gallery').invalidate();
  let sessionId = '';
  let out;
  for (let i = 0; i < 10; i += 1) {
    const res = await admin.post('/api/kiosk/scan').set(XHR).field('sessionId', sessionId).attach('image', images[i % images.length]);
    out = res.body;
    sessionId = out.sessionId;
    if (out.terminal) break;
  }
  assert.equal(out.state, 'UNKNOWN');
  await Student.updateMany({}, { active: true });
});

test('engine does not leak tensors across frames', async (t) => {
  if (skip) return t.skip(skip);
  const engine = require('../src/services/faceEngine');
  const { analyzeFrame } = require('../src/services/faceAnalysis');
  const buf = fs.readFileSync(images[0]);
  await analyzeFrame(buf);
  const before = engine.memory().numTensors;
  for (let i = 0; i < 5; i += 1) await analyzeFrame(buf);
  assert.equal(engine.memory().numTensors, before);
});
