// Developer tool: print quality/pose/liveness measurements for a folder of
// images so thresholds can be sanity-checked on your own camera.
// Usage: node scripts/probe-images.js <folder>
const fs = require('fs');
const path = require('path');
const engine = require('../src/services/faceEngine');
const liveness = require('../src/services/liveness');
const { assessQuality } = require('../src/services/quality');

(async () => {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage: node scripts/probe-images.js <folder>');
  await engine.init();
  await liveness.init();
  for (const f of fs.readdirSync(dir).filter((x) => /\.(jpe?g|png)$/i.test(x))) {
    const started = Date.now();
    const row = await engine.withImage(fs.readFileSync(path.join(dir, f)), async (frame) => {
      const faces = await frame.detect();
      if (!faces.length) return { faces: 0 };
      const face = faces[0];
      const pixels = frame.pixelStats(face.box);
      const q = assessQuality({ ...face, pixels, imageWidth: frame.width, imageHeight: frame.height });
      const live = await liveness.passiveScore(frame, face.box);
      return { faces: faces.length, ok: q.ok, issues: q.issues.join(','), ...q.metrics, ear: +face.pose.ear.toFixed(3), live: live == null ? null : +live.toFixed(3) };
    });
    console.log(f.slice(0, 24).padEnd(24), JSON.stringify({ ...row, ms: Date.now() - started }));
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
