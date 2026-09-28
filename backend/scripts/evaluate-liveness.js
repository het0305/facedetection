// Passive liveness (presentation attack detection) evaluation.
//
//   npm run evaluate-liveness -- --live <dir> --spoof <dir> [--out <dir>]
//
// <live>:  real people in front of the kiosk camera (varied lighting/people)
// <spoof>: the kiosk camera pointed at printed photos, phone and monitor
//          screens, replayed videos (frames), ideally sorted in sub-folders
//          (print/, phone/, screen/...) — the report breaks results down per folder.
//
// Metrics (ISO/IEC 30107-3 terminology):
//   APCER = attacks wrongly accepted as live   (security)
//   BPCER = real people wrongly rejected       (convenience)
// These are per-frame numbers; the kiosk averages >= LIVENESS_MIN_FRAMES
// frames and adds an active challenge, so end-to-end rates are lower.
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const engine = require('../src/services/faceEngine');
const liveness = require('../src/services/liveness');

const IMG = /\.(jpe?g|png)$/i;
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : IMG.test(e.name) ? [p] : [];
  });
const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : 'n/a');

async function scores(dir) {
  const out = [];
  let skipped = 0;
  for (const f of walk(dir)) {
    const s = await engine.withImage(fs.readFileSync(f), async (frame) => {
      const faces = await frame.detect();
      if (faces.length !== 1) return null;
      return liveness.passiveScore(frame, faces[0].box);
    });
    if (s == null) skipped += 1;
    else out.push({ file: f, group: path.relative(dir, path.dirname(f)) || '.', score: s });
  }
  return { out, skipped };
}

(async () => {
  const args = process.argv.slice(2);
  const arg = (k) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : null);
  const liveDir = arg('--live');
  const spoofDir = arg('--spoof');
  const outDir = arg('--out') || path.join(__dirname, '../../evaluation');
  if (!liveDir || !spoofDir) throw new Error('Usage: npm run evaluate-liveness -- --live <dir> --spoof <dir>');
  await engine.init();
  await liveness.init();

  const live = await scores(liveDir);
  const spoof = await scores(spoofDir);
  if (!live.out.length || !spoof.out.length) throw new Error('Need at least one usable live and one usable spoof image.');

  const rows = [];
  for (let t = 0.3; t <= 0.951; t += 0.05) {
    const th = Math.round(t * 100) / 100;
    rows.push({
      threshold: th,
      APCER: spoof.out.filter((s) => s.score >= th).length / spoof.out.length,
      BPCER: live.out.filter((s) => s.score < th).length / live.out.length,
    });
  }
  const groups = {};
  for (const s of spoof.out) (groups[s.group] ||= []).push(s.score);

  const md = [`# Liveness evaluation — ${new Date().toISOString()}`, ''];
  md.push(`Live frames: ${live.out.length} (skipped ${live.skipped}) · attack frames: ${spoof.out.length} (skipped ${spoof.skipped})`, '');
  md.push(`Configured LIVENESS_THRESHOLD = ${config.LIVENESS_THRESHOLD}`, '');
  md.push('| threshold | APCER (attacks accepted) | BPCER (real rejected) |', '|---|---|---|');
  for (const r of rows) md.push(`| ${r.threshold} | ${pct(r.APCER)} | ${pct(r.BPCER)} |`);
  md.push('', '## Attack types at configured threshold', '');
  for (const [g, s] of Object.entries(groups)) {
    md.push(`- ${g}: ${s.length} frames, accepted ${pct(s.filter((x) => x >= config.LIVENESS_THRESHOLD).length / s.length)}, max score ${Math.max(...s).toFixed(3)}`);
  }
  const worstLive = [...live.out].sort((a, b) => a.score - b.score).slice(0, 5);
  md.push('', '## Lowest-scoring real faces (check lighting/camera)', '');
  for (const w of worstLive) md.push(`- ${path.basename(w.file)}: ${w.score.toFixed(3)}`);

  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `liveness-${Date.now()}.md`);
  fs.writeFileSync(file, md.join('\n'));
  console.log(md.join('\n'));
  console.log(`\nReport written to ${file}`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
