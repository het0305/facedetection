// Face descriptors are encrypted at rest with AES-256-GCM. A database dump
// without BIOMETRIC_KEY does not reveal usable biometric templates.
// Layout of the stored buffer: [12-byte IV][16-byte auth tag][ciphertext].
const crypto = require('crypto');
const config = require('../config');

const KEY = Buffer.from(config.BIOMETRIC_KEY, 'hex');
const DESCRIPTOR_LENGTH = 128;

function encryptDescriptor(descriptor) {
  const floats = Float32Array.from(descriptor);
  if (floats.length !== DESCRIPTOR_LENGTH || !floats.every(Number.isFinite)) {
    throw new Error('Invalid face descriptor');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const plain = Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

function decryptDescriptor(blob) {
  // Accepts a Buffer or a BSON Binary (from lean queries); Binary.buffer is a Uint8Array view.
  const buf = Buffer.isBuffer(blob) ? blob : blob?._bsontype === 'Binary' ? Buffer.from(blob.buffer) : Buffer.from(blob);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
  const out = new Float32Array(DESCRIPTOR_LENGTH);
  new Uint8Array(out.buffer).set(plain);
  return out;
}

module.exports = { encryptDescriptor, decryptDescriptor, DESCRIPTOR_LENGTH };
