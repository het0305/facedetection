// Test environment. Must be required before anything from src/.
// Uses a separate database on the local MongoDB so real data is never touched.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/faceattendance_test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-0123456789';
process.env.BIOMETRIC_KEY = '0'.repeat(63) + '1';
process.env.APP_TIMEZONE = 'Asia/Kolkata';

const fs = require('fs');
const path = require('path');

/** 68 synthetic landmarks for a frontal face centred at (cx, cy) with width w. */
function frontalLandmarks({ cx = 200, cy = 200, w = 120, noseShift = 0, eyeOpen = 1, roll = 0 } = {}) {
  const pts = new Array(68).fill(null).map(() => ({ x: cx, y: cy }));
  const h = w * 1.2;
  for (let i = 0; i <= 16; i += 1) {
    const t = i / 16;
    pts[i] = { x: cx - w / 2 + t * w, y: cy - h * 0.1 + Math.sin(t * Math.PI) * h * 0.5 };
  }
  pts[8] = { x: cx, y: cy + h * 0.4 };
  pts[30] = { x: cx + noseShift * w, y: cy };
  const eye = (ex, ey) => {
    const ew = w * 0.18;
    const eh = ew * 0.3 * eyeOpen;
    return [
      { x: ex - ew / 2, y: ey },
      { x: ex - ew / 6, y: ey - eh },
      { x: ex + ew / 6, y: ey - eh },
      { x: ex + ew / 2, y: ey },
      { x: ex + ew / 6, y: ey + eh },
      { x: ex - ew / 6, y: ey + eh },
    ];
  };
  const eyeY = cy - h * 0.15;
  const dy = Math.tan((roll * Math.PI) / 180) * (w * 0.2);
  eye(cx - w * 0.2, eyeY - dy).forEach((p, i) => (pts[36 + i] = p));
  eye(cx + w * 0.2, eyeY + dy).forEach((p, i) => (pts[42 + i] = p));
  return pts;
}

/** Deterministic pseudo-random unit-ish descriptor. */
function descriptor(seed, noise = 0, noiseSeed = 1) {
  let s = seed * 9301 + 49297;
  let n = noiseSeed * 7919 + 1;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280) - 0.5;
  const rndN = () => ((n = (n * 9301 + 49297) % 233280) / 233280) - 0.5;
  const d = new Float32Array(128);
  for (let i = 0; i < 128; i += 1) d[i] = rnd() * 0.2 + rndN() * noise;
  return d;
}

/** Local face images for integration tests (never committed). */
function localFaceImages() {
  const dir = process.env.FACE_TEST_DIR || path.join(__dirname, '../uploads');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .map((f) => path.join(dir, f));
}

async function connectTestDb() {
  const mongoose = require('mongoose');
  const db = require('../src/db');
  await db.connect();
  await mongoose.connection.db.dropDatabase();
  const { runMigrations } = require('../src/migrations');
  await runMigrations();
  return mongoose;
}

async function mongoAvailable() {
  const net = require('net');
  const { hostname, port } = new URL(process.env.MONGO_URI.replace('mongodb://', 'http://'));
  return new Promise((resolve) => {
    const sock = net.connect({ host: hostname, port: Number(port) || 27017 });
    sock.setTimeout(1000);
    sock.on('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => {
      sock.destroy();
      resolve(false);
    });
  });
}

module.exports = { frontalLandmarks, descriptor, localFaceImages, connectTestDb, mongoAvailable };
