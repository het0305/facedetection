require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { PNG } = require('pngjs');
const { dayKeyOf, isLate } = require('../src/utils/time');
const { encryptDescriptor, decryptDescriptor } = require('../src/utils/biometricCrypto');
const { decodeImage } = require('../src/services/imageDecoder');
const logger = require('../src/utils/logger');
const { descriptor } = require('./helpers');

test('attendance day follows APP_TIMEZONE, not the server clock', () => {
  // 20:00 UTC = 01:30 next day in Asia/Kolkata (UTC+5:30)
  assert.equal(dayKeyOf(new Date('2026-09-28T20:00:00Z'), 'Asia/Kolkata'), '2026-09-29');
  assert.equal(dayKeyOf(new Date('2026-09-28T20:00:00Z'), 'UTC'), '2026-09-28');
  assert.equal(dayKeyOf(new Date('2026-09-28T18:29:59Z'), 'Asia/Kolkata'), '2026-09-28');
});

test('late rule', () => {
  const at = new Date('2026-09-28T04:15:00Z'); // 09:45 IST
  assert.equal(isLate(at, '09:30', 'Asia/Kolkata'), true);
  assert.equal(isLate(at, '10:00', 'Asia/Kolkata'), false);
  assert.equal(isLate(at, undefined, 'Asia/Kolkata'), false);
});

test('descriptor encryption round-trips and detects tampering', () => {
  const d = descriptor(3);
  const blob = encryptDescriptor(d);
  assert.equal(blob.length, 12 + 16 + 512);
  assert.deepEqual(Array.from(decryptDescriptor(blob)), Array.from(d));
  assert.notDeepEqual(encryptDescriptor(d), blob, 'random IV per encryption');
  const tampered = Buffer.from(blob);
  tampered[40] ^= 1;
  assert.throws(() => decryptDescriptor(tampered));
  assert.throws(() => encryptDescriptor(new Float32Array(10)));
  assert.throws(() => encryptDescriptor(new Float32Array(128).fill(NaN)));
});

test('image decoder rejects non-images and malformed files', () => {
  assert.throws(() => decodeImage(Buffer.from('<?php echo 1; ?>')), { code: 'UNSUPPORTED_IMAGE' });
  assert.throws(() => decodeImage(Buffer.from([0xff, 0xd8, 0xff, 0x00, 1, 2, 3, 4])), { code: 'INVALID_IMAGE' });
  assert.throws(() => decodeImage(Buffer.alloc(0)), { code: 'INVALID_IMAGE' });
});

test('image decoder enforces dimensions and decodes PNG to RGB', () => {
  const small = new PNG({ width: 50, height: 50 });
  assert.throws(() => decodeImage(PNG.sync.write(small)), { code: 'IMAGE_TOO_SMALL' });
  const png = new PNG({ width: 200, height: 180 });
  png.data.fill(128);
  const out = decodeImage(PNG.sync.write(png));
  assert.equal(out.width, 200);
  assert.equal(out.data.length, 200 * 180 * 3);
  // Header claiming an enormous PNG is rejected before inflating.
  const huge = PNG.sync.write(png);
  huge.writeUInt32BE(50000, 16);
  assert.throws(() => decodeImage(huge), { code: 'IMAGE_TOO_LARGE' });
});

test('logger redacts secrets and biometric fields', () => {
  const out = logger.sanitize({
    password: 'x',
    token: 'y',
    descriptor: [1, 2],
    samples: [{ enc: 'z' }],
    nested: { passwordHash: 'h', embeddings: [1] },
    dayKey: '2026-09-28',
    rollNo: 'A1',
  });
  assert.equal(out.password, '[redacted]');
  assert.equal(out.token, '[redacted]');
  assert.equal(out.descriptor, '[redacted]');
  assert.equal(out.samples, '[redacted]');
  assert.equal(out.nested.passwordHash, '[redacted]');
  assert.equal(out.nested.embeddings, '[redacted]');
  assert.equal(out.dayKey, '2026-09-28');
  assert.equal(out.rollNo, 'A1');
});
