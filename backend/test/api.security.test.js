require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { connectTestDb, mongoAvailable } = require('./helpers');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
let app;
let mongoose;
let skip = false;

test.before(async () => {
  if (!(await mongoAvailable())) {
    skip = 'MongoDB not reachable';
    return;
  }
  mongoose = await connectTestDb();
  const Admin = require('../src/models/Admin');
  await Admin.create({ username: 'admin', passwordHash: await bcrypt.hash('correct-horse-9', 4) });
  await Admin.create({ username: 'locktest', passwordHash: await bcrypt.hash('correct-horse-9', 4) });
  app = require('../src/app').createApp();
});

test.after(async () => {
  if (mongoose) await mongoose.disconnect();
});

async function login(username = 'admin', password = 'correct-horse-9') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(XHR).send({ username, password });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return agent;
}

const ADMIN_ROUTES = [
  ['get', '/api/students'],
  ['get', '/api/students/duplicates'],
  ['post', '/api/students'],
  ['post', '/api/students/check-sample'],
  ['patch', '/api/students/507f1f77bcf86cd799439011'],
  ['put', '/api/students/507f1f77bcf86cd799439011/face'],
  ['delete', '/api/students/507f1f77bcf86cd799439011'],
  ['get', '/api/attendance'],
  ['get', '/api/attendance/export'],
  ['patch', '/api/attendance/507f1f77bcf86cd799439011'],
  ['delete', '/api/attendance/507f1f77bcf86cd799439011'],
  ['get', '/api/admin/dashboard'],
  ['get', '/api/admin/audit'],
  ['get', '/api/admin/devices'],
  ['get', '/api/admin/system'],
  ['get', '/api/download-attendance'],
  ['post', '/api/auth/kiosk/activate'],
  ['post', '/api/auth/change-password'],
];

test('every admin endpoint rejects anonymous requests', async (t) => {
  if (skip) return t.skip(skip);
  for (const [method, url] of ADMIN_ROUTES) {
    const res = await request(app)[method](url).set(XHR);
    assert.equal(res.status, 401, `${method.toUpperCase()} ${url} -> ${res.status}`);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  }
  const scan = await request(app).post('/api/kiosk/scan').set(XHR);
  assert.equal(scan.status, 401);
});

test('state-changing requests without the CSRF header or from a foreign origin are blocked', async (t) => {
  if (skip) return t.skip(skip);
  const noHeader = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'correct-horse-9' });
  assert.equal(noHeader.status, 403);
  const foreign = await request(app)
    .post('/api/auth/login')
    .set(XHR)
    .set('Origin', 'https://evil.example')
    .send({ username: 'admin', password: 'correct-horse-9' });
  assert.equal(foreign.status, 403);
});

test('login: success sets an httpOnly SameSite=Strict cookie, wrong password is generic', async (t) => {
  if (skip) return t.skip(skip);
  const ok = await request(app).post('/api/auth/login').set(XHR).send({ username: 'ADMIN ', password: 'correct-horse-9' });
  assert.equal(ok.status, 200);
  const cookie = ok.headers['set-cookie'].join(';');
  assert.match(cookie, /fa_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.equal(JSON.stringify(ok.body).includes('passwordHash'), false);

  const bad = await request(app).post('/api/auth/login').set(XHR).send({ username: 'admin', password: 'nope' });
  const unknown = await request(app).post('/api/auth/login').set(XHR).send({ username: 'ghost', password: 'nope' });
  assert.equal(bad.status, 401);
  assert.deepEqual(bad.body, unknown.body, 'same response for unknown user and wrong password');
});

test('NoSQL injection and malformed bodies are rejected by validation', async (t) => {
  if (skip) return t.skip(skip);
  const inj = await request(app).post('/api/auth/login').set(XHR).send({ username: { $ne: null }, password: { $ne: null } });
  assert.equal(inj.status, 400);
  assert.equal(inj.body.error.code, 'VALIDATION_ERROR');
  const junk = await request(app).post('/api/auth/login').set(XHR).set('Content-Type', 'application/json').send('{bad json');
  assert.equal(junk.status, 400);
  assert.equal(JSON.stringify(junk.body).includes('at '), false, 'no stack trace');
  const big = await request(app).post('/api/auth/login').set(XHR).send({ username: 'a', password: 'x'.repeat(50000) });
  assert.equal(big.status, 413);
});

test('account locks after repeated failures', async (t) => {
  if (skip) return t.skip(skip);
  for (let i = 0; i < 5; i += 1) {
    await request(app).post('/api/auth/login').set(XHR).send({ username: 'locktest', password: 'wrong' });
  }
  const res = await request(app).post('/api/auth/login').set(XHR).send({ username: 'locktest', password: 'correct-horse-9' });
  assert.equal(res.status, 429);
  assert.equal(res.body.error.code, 'ACCOUNT_LOCKED');
});

test('logout revokes the session token server-side', async (t) => {
  if (skip) return t.skip(skip);
  const res = await request(app).post('/api/auth/login').set(XHR).send({ username: 'admin', password: 'correct-horse-9' });
  const cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  assert.equal((await request(app).get('/api/students').set('Cookie', cookie)).status, 200);
  await request(app).post('/api/auth/logout').set(XHR).set('Cookie', cookie);
  // Replaying the old cookie after logout must fail.
  assert.equal((await request(app).get('/api/students').set('Cookie', cookie)).status, 401);
});

test('tampered or forged tokens are rejected', async (t) => {
  if (skip) return t.skip(skip);
  const jwt = require('jsonwebtoken');
  const Admin = require('../src/models/Admin');
  const admin = await Admin.findOne({ username: 'admin' });
  const forged = jwt.sign({ tv: admin.tokenVersion }, 'wrong-secret-wrong-secret-wrong-secret!!', {
    subject: String(admin._id),
    audience: 'admin',
    issuer: 'face-attendance',
  });
  assert.equal((await request(app).get('/api/students').set('Cookie', `fa_session=${forged}`)).status, 401);
  const none = jwt.sign({ tv: admin.tokenVersion, sub: String(admin._id), aud: 'admin', iss: 'face-attendance' }, '', {
    algorithm: 'none',
  });
  assert.equal((await request(app).get('/api/students').set('Cookie', `fa_session=${none}`)).status, 401);
});

test('kiosk token can scan but cannot use admin endpoints; revocation works', async (t) => {
  if (skip) return t.skip(skip);
  const admin = await login();
  const act = await admin.post('/api/auth/kiosk/activate').set(XHR).send({ name: 'Front desk' });
  assert.equal(act.status, 201);
  const kioskCookie = act.headers['set-cookie'].find((c) => c.startsWith('fa_kiosk=')).split(';')[0];

  assert.equal((await request(app).get('/api/students').set('Cookie', kioskCookie)).status, 401);
  assert.equal((await request(app).get('/api/admin/dashboard').set('Cookie', kioskCookie)).status, 401);
  // Authorised to reach the scan handler (fails validation because no image was sent).
  const scan = await request(app).post('/api/kiosk/scan').set(XHR).set('Cookie', kioskCookie);
  assert.equal(scan.status, 400);
  assert.equal(scan.body.error.code, 'NO_IMAGE');

  // A kiosk token must not be accepted as an admin session (audience check).
  const token = kioskCookie.split('=')[1];
  assert.equal((await request(app).get('/api/students').set('Cookie', `fa_session=${token}`)).status, 401);

  await admin.patch(`/api/admin/devices/${act.body.kiosk.id}`).set(XHR).send({ active: false });
  const revoked = await request(app).post('/api/kiosk/scan').set(XHR).set('Cookie', kioskCookie);
  assert.equal(revoked.status, 401);
});

test('upload abuse: non-images, disguised files, oversized files', async (t) => {
  if (skip) return t.skip(skip);
  const admin = await login();
  const php = await admin
    .post('/api/students/check-sample')
    .set(XHR)
    .attach('image', Buffer.from('<?php system($_GET[1]); ?>'), { filename: 'face.jpg', contentType: 'image/jpeg' });
  assert.equal(php.status, 400);
  assert.equal(php.body.error.code, 'UNSUPPORTED_IMAGE');

  const svg = await admin
    .post('/api/students/check-sample')
    .set(XHR)
    .attach('image', Buffer.from('<svg onload=alert(1)>'), { filename: 'x.svg', contentType: 'image/svg+xml' });
  assert.equal(svg.status, 400);

  const huge = Buffer.alloc(3 * 1024 * 1024, 0xff);
  huge[0] = 0xff;
  huge[1] = 0xd8;
  huge[2] = 0xff;
  const big = await admin
    .post('/api/students/check-sample')
    .set(XHR)
    .attach('image', huge, { filename: 'big.jpg', contentType: 'image/jpeg' });
  assert.equal(big.status, 413);

  const traversal = await admin
    .post('/api/students/check-sample')
    .set(XHR)
    .attach('image', Buffer.from('x'), { filename: '../../server.js', contentType: 'image/jpeg' });
  assert.equal(traversal.status, 400);
});

test('input validation on registration fields and ids', async (t) => {
  if (skip) return t.skip(skip);
  const admin = await login();
  const bad = await admin
    .post('/api/students')
    .set(XHR)
    .field('name', '<script>alert(1)</script>')
    .field('rollNo', 'A1')
    .field('poses', 'front');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error.message, /^name:/);
  const badId = await admin.get('/api/students/not-an-id');
  assert.equal(badId.status, 400);
  const badDate = await admin.get('/api/attendance?from=2026-13-99x');
  assert.equal(badDate.status, 400);
  // Express 5's simple query parser never builds objects from `search[$gt]=`;
  // repeated keys (arrays) are the remaining vector and must be rejected.
  const arr = await admin.get('/api/students?search=a&search=b');
  assert.equal(arr.status, 400);
  const bracket = await admin.get('/api/students?search[$gt]=');
  assert.equal(bracket.status, 200);
  assert.equal(bracket.body.total, 0, 'treated as an unknown literal key, not an operator');
});

test('responses never expose biometric data; uploads are not served', async (t) => {
  if (skip) return t.skip(skip);
  const Student = require('../src/models/Student');
  const { encryptDescriptor } = require('../src/utils/biometricCrypto');
  const { descriptor } = require('./helpers');
  await Student.create({ name: 'Leak Test', rollNo: 'LEAK1', samples: [{ enc: encryptDescriptor(descriptor(5)) }], sampleCount: 1 });
  const admin = await login();
  const list = await admin.get('/api/students?search=LEAK1');
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  const text = JSON.stringify(list.body);
  for (const key of ['samples', 'enc', 'embeddings', 'descriptor']) assert.equal(text.includes(`"${key}"`), false, key);
  const one = await admin.get(`/api/students/${list.body.items[0]._id}`);
  assert.equal(JSON.stringify(one.body).includes('"samples"'), false);
  assert.equal((await request(app).get('/uploads/anything.jpg')).status, 404);
});

test('security headers are set and internals are hidden', async (t) => {
  if (skip) return t.skip(skip);
  const res = await request(app).get('/api/health');
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['cache-control'], 'no-store');
  const nf = await request(app).get('/api/nope');
  assert.equal(nf.status, 404);
});
