// Rotate BIOMETRIC_KEY (re-encrypting every stored face template) and
// JWT_SECRET (signs everyone out), then update backend/.env.
//
//   npm run rotate-keys
//
// Safe to re-run after an interruption: each template is decrypted with the
// new key first and falls back to the old one, so a partially rotated
// database is repaired on the next run. The previous .env is kept as
// .env.bak-<timestamp> until you delete it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENV_PATH = path.join(__dirname, '../.env');

function decrypt(key, blob) {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob.buffer);
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}

function encrypt(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

(async () => {
  const env = fs.readFileSync(ENV_PATH, 'utf8');
  const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
  const oldKeyHex = get('BIOMETRIC_KEY');
  if (!/^[0-9a-f]{64}$/i.test(oldKeyHex || '')) throw new Error('BIOMETRIC_KEY missing in .env');
  const pendingFile = path.join(__dirname, '../.env.rotation-pending');
  // Reuse an unfinished rotation's new key so a re-run completes it.
  const newKeyHex = fs.existsSync(pendingFile) ? fs.readFileSync(pendingFile, 'utf8').trim() : crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(pendingFile, newKeyHex, { mode: 0o600 });
  const oldKey = Buffer.from(oldKeyHex, 'hex');
  const newKey = Buffer.from(newKeyHex, 'hex');

  const mongoose = require('mongoose');
  await mongoose.connect(get('MONGO_URI'));
  const col = mongoose.connection.db.collection('students');
  let rotated = 0;
  for await (const s of col.find({ 'samples.0': { $exists: true } })) {
    const samples = s.samples.map((x) => {
      let plain;
      try {
        plain = decrypt(newKey, x.enc);
        return x; // already rotated
      } catch {
        plain = decrypt(oldKey, x.enc); // throws if neither key works
      }
      return { ...x, enc: encrypt(newKey, plain) };
    });
    await col.updateOne({ _id: s._id }, { $set: { samples } });
    rotated += 1;
  }
  await mongoose.disconnect();

  fs.copyFileSync(ENV_PATH, `${ENV_PATH}.bak-${Date.now()}`);
  const next = env
    .replace(/^BIOMETRIC_KEY=.*$/m, `BIOMETRIC_KEY=${newKeyHex}`)
    .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${crypto.randomBytes(48).toString('base64url')}`);
  fs.writeFileSync(ENV_PATH, next, { mode: 0o600 });
  fs.unlinkSync(pendingFile);
  console.log(`Re-encrypted templates for ${rotated} people. New keys written to backend/.env.`);
  console.log('All admin and kiosk sessions are now signed out. Restart the server.');
  console.log('Delete the .env.bak-* file once you have confirmed the server starts correctly.');
})().catch((err) => {
  console.error(`Rotation failed: ${err.message}. Nothing in .env was changed; re-run to resume.`);
  process.exit(1);
});
