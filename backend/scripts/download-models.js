// Downloads the anti-spoofing ONNX models (Silent-Face MiniFASNet, Apache-2.0,
// exported by github.com/yakhyo/face-anti-spoofing) and verifies SHA-256.
// Face detection/recognition models ship inside @vladmandic/face-api.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const DIR = path.join(__dirname, '../models/antispoof');
const BASE = 'https://github.com/yakhyo/face-anti-spoofing/releases/download/weights/';
const MODELS = {
  'MiniFASNetV2.onnx': 'b32929adc2d9c34b9486f8c4c7bc97c1b69bc0ea9befefc380e4faae4e463907',
  'MiniFASNetV1SE.onnx': 'ebab7f90c7833fbccd46d3a555410e78d969db5438e169b6524be444862b3676',
};

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          return resolve(get(new URL(res.headers.location, url).toString(), redirects - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  for (const [file, hash] of Object.entries(MODELS)) {
    const dest = path.join(DIR, file);
    if (fs.existsSync(dest) && sha256(fs.readFileSync(dest)) === hash) {
      console.log(`${file}: ok`);
      continue;
    }
    console.log(`${file}: downloading...`);
    const buf = await get(BASE + file);
    if (sha256(buf) !== hash) throw new Error(`${file}: checksum mismatch, refusing to install`);
    fs.writeFileSync(dest, buf);
    console.log(`${file}: installed`);
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
