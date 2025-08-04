const fs = require('fs');
const https = require('https');
const path = require('path');

const files = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model-shard1',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2',
];

const baseUrl = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/';
const modelsDir = path.join(__dirname, '../models');

if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir);

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Handle redirect
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url}, status: ${res.statusCode}`));
      }
      const fileStream = fs.createWriteStream(dest);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
    }).on('error', reject);
  });
}

(async () => {
  for (const file of files) {
    const filePath = path.join(modelsDir, file);
    if (!fs.existsSync(filePath)) {
      console.log(`Downloading ${file}...`);
      try {
        await downloadFile(baseUrl + file, filePath);
        console.log(`${file} downloaded `);
      } catch (err) {
        console.error(` Failed to download ${file}: ${err.message}`);
      }
    } else {
      console.log(`${file} already exists, skipping.`);
    }
  }
})();
