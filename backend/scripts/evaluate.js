// Recognition accuracy evaluation and threshold calibration.
//
// Dataset layout (enrollment and probe photos MUST be different captures):
//   <dataset>/<personId>/enroll/*.jpg   photos used to build that person's template
//   <dataset>/<personId>/probe/*.jpg    separate photos used only for testing
//   <dataset>/_unknown/**/*.jpg         people who are NOT enrolled (impostors)
//
// Usage: npm run evaluate -- <dataset> [--out <dir>]
// Writes <out>/recognition-<timestamp>.md and .json (default: ../evaluation).
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const engine = require('../src/services/faceEngine');
const { analyzeFrame } = require('../src/services/faceAnalysis');
const matcher = require('../src/services/matcher');

const IMG = /\.(jpe?g|png)$/i;
const listImages = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? listImages(p) : IMG.test(e.name) ? [p] : [];
      })
    : [];

const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : 'n/a');
const quantile = (xs, q) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

async function embed(file, stats) {
  const t0 = Date.now();
  const a = await analyzeFrame(fs.readFileSync(file), { mode: 'recognition', liveness: false });
  stats.latency.push(Date.now() - t0);
  stats.total += 1;
  if (a.faceCount === 0) stats.noFace += 1;
  else if (a.faceCount > 1) stats.multiFace += 1;
  else if (!a.face.quality.ok) {
    stats.lowQuality += 1;
    stats.qualityIssues[a.face.quality.issues[0]] = (stats.qualityIssues[a.face.quality.issues[0]] || 0) + 1;
  } else {
    stats.ok += 1;
    return a.face.descriptor;
  }
  return null;
}

(async () => {
  const args = process.argv.slice(2);
  const dataset = args.find((a) => !a.startsWith('--'));
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(__dirname, '../../evaluation');
  if (!dataset || !fs.existsSync(dataset)) throw new Error('Usage: npm run evaluate -- <dataset> [--out <dir>]');
  await engine.init();

  const stats = { total: 0, ok: 0, noFace: 0, multiFace: 0, lowQuality: 0, qualityIssues: {}, latency: [] };
  const people = [];
  const probes = []; // { person|null, d }
  for (const entry of fs.readdirSync(dataset, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(dataset, entry.name);
    if (entry.name === '_unknown') {
      for (const f of listImages(dir)) {
        const d = await embed(f, stats);
        if (d) probes.push({ person: null, d, file: f });
      }
      continue;
    }
    const enrollFiles = listImages(path.join(dir, 'enroll'));
    const probeFiles = listImages(path.join(dir, 'probe'));
    if (!enrollFiles.length || !probeFiles.length) {
      console.warn(`skipping ${entry.name}: needs both enroll/ and probe/ images`);
      continue;
    }
    const descriptors = [];
    for (const f of enrollFiles) {
      const d = await embed(f, stats);
      if (d) descriptors.push(d);
    }
    if (!descriptors.length) {
      console.warn(`skipping ${entry.name}: no usable enrollment image`);
      continue;
    }
    people.push({ id: entry.name, descriptors, centroid: matcher.centroid(descriptors) });
    for (const f of probeFiles) {
      const d = await embed(f, stats);
      if (d) probes.push({ person: entry.name, d, file: f });
    }
  }
  if (people.length < 2) throw new Error('Need at least 2 enrolled people for a meaningful evaluation.');

  const strategies = ['min', 'centroid'];
  const thresholds = [];
  for (let t = 0.3; t <= 0.701; t += 0.02) thresholds.push(Math.round(t * 100) / 100);

  const report = { generatedAt: new Date().toISOString(), dataset: path.resolve(dataset), config: {}, strategies: {} };
  report.config = {
    RECOGNITION_THRESHOLD: config.RECOGNITION_THRESHOLD,
    RECOGNITION_MIN_MARGIN: config.RECOGNITION_MIN_MARGIN,
    HIGH_CONFIDENCE_THRESHOLD: config.HIGH_CONFIDENCE_THRESHOLD,
    MATCH_STRATEGY: config.MATCH_STRATEGY,
  };
  report.detection = {
    images: stats.total,
    usable: stats.ok,
    successRate: stats.ok / stats.total,
    noFace: stats.noFace,
    multipleFaces: stats.multiFace,
    lowQuality: stats.lowQuality,
    qualityIssues: stats.qualityIssues,
  };
  report.latencyMs = { mean: stats.latency.reduce((a, b) => a + b, 0) / stats.latency.length, p95: quantile(stats.latency, 0.95) };
  report.counts = {
    enrolledPeople: people.length,
    genuineProbes: probes.filter((p) => p.person).length,
    unknownProbes: probes.filter((p) => !p.person).length,
  };

  for (const strategy of strategies) {
    const genuine = [];
    const impostor = [];
    for (const p of probes) {
      for (const person of people) {
        const d = matcher.personDistance(p.d, person, strategy);
        (p.person === person.id ? genuine : impostor).push(d);
      }
    }
    const verification = thresholds.map((t) => {
      const far = impostor.filter((d) => d <= t).length / impostor.length;
      const frr = genuine.filter((d) => d > t).length / genuine.length;
      return { threshold: t, FAR: far, FRR: frr, TAR: 1 - frr };
    });
    const eer = verification.reduce((best, r) => (Math.abs(r.FAR - r.FRR) < Math.abs(best.FAR - best.FRR) ? r : best));

    // 1:N identification with the production decision rule (threshold + margin).
    const identify = (t) => {
      const cfg = { ...config, RECOGNITION_THRESHOLD: t, HIGH_CONFIDENCE_THRESHOLD: Math.min(t, config.HIGH_CONFIDENCE_THRESHOLD), MATCH_STRATEGY: strategy };
      let correct = 0;
      let wrong = 0;
      let rejectedGenuine = 0;
      let unknownRejected = 0;
      let unknownAccepted = 0;
      for (const p of probes) {
        const r = matcher.match(p.d, people, cfg);
        if (p.person) {
          if (!r.accepted) rejectedGenuine += 1;
          else if (r.id === p.person) correct += 1;
          else wrong += 1;
        } else if (r.accepted) unknownAccepted += 1;
        else unknownRejected += 1;
      }
      const g = report.counts.genuineProbes;
      const u = report.counts.unknownProbes;
      return {
        threshold: t,
        correctIdentification: correct / g,
        wrongIdentification: wrong / g,
        falseRejection: rejectedGenuine / g,
        unknownRejection: u ? unknownRejected / u : NaN,
        unknownFalseAccept: u ? unknownAccepted / u : NaN,
        falseAccepts: wrong + unknownAccepted,
      };
    };
    const identification = thresholds.map(identify);
    const safe = identification.filter((r) => r.falseAccepts === 0);
    const maxSafe = safe.length ? safe[safe.length - 1].threshold : null;
    const recommended = maxSafe != null ? Math.max(0.3, Math.round((maxSafe - 0.04) * 100) / 100) : null;

    report.strategies[strategy] = {
      genuine: { n: genuine.length, mean: genuine.reduce((a, b) => a + b, 0) / genuine.length, p95: quantile(genuine, 0.95), max: Math.max(...genuine) },
      impostor: { n: impostor.length, min: Math.min(...impostor), p5: quantile(impostor, 0.05), mean: impostor.reduce((a, b) => a + b, 0) / impostor.length },
      eer: { threshold: eer.threshold, rate: (eer.FAR + eer.FRR) / 2 },
      verification,
      identification,
      atConfiguredThreshold: identify(config.RECOGNITION_THRESHOLD),
      maxThresholdWithZeroObservedFalseAccepts: maxSafe,
      recommendedThreshold: recommended,
      // "Rule of three": with zero errors in N trials the 95% upper bound on the rate is ~3/N.
      farUpperBound95: 3 / impostor.length,
    };
  }

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(outDir, `recognition-${stamp}.json`), JSON.stringify(report, null, 2));

  const md = [];
  md.push(`# Recognition evaluation — ${report.generatedAt}`, '');
  md.push(`Dataset: \`${report.dataset}\``, '');
  md.push(`People enrolled: ${report.counts.enrolledPeople} · genuine probes: ${report.counts.genuineProbes} · unknown-person probes: ${report.counts.unknownProbes}`, '');
  md.push('## Detection / quality', '');
  md.push(`Usable faces: ${report.detection.usable}/${report.detection.images} (${pct(report.detection.successRate)}) · no face: ${stats.noFace} · multiple faces: ${stats.multiFace} · rejected by quality gate: ${stats.lowQuality} ${JSON.stringify(stats.qualityIssues)}`, '');
  md.push(`Latency per frame (detect + landmarks + quality + embedding, backend ${engine.status().backend}): mean ${report.latencyMs.mean.toFixed(0)} ms, p95 ${report.latencyMs.p95} ms`, '');
  for (const s of strategies) {
    const r = report.strategies[s];
    md.push(`## Strategy: ${s}${s === config.MATCH_STRATEGY ? ' (configured)' : ''}`, '');
    md.push(`Genuine distance: mean ${r.genuine.mean.toFixed(3)}, p95 ${r.genuine.p95.toFixed(3)}, max ${r.genuine.max.toFixed(3)}`);
    md.push(`Impostor distance: min ${r.impostor.min.toFixed(3)}, p5 ${r.impostor.p5.toFixed(3)}, mean ${r.impostor.mean.toFixed(3)}`);
    md.push(`EER ≈ ${pct(r.eer.rate)} at ${r.eer.threshold}`, '');
    const c = r.atConfiguredThreshold;
    md.push(`At configured threshold ${config.RECOGNITION_THRESHOLD} (margin ${config.RECOGNITION_MIN_MARGIN}): correct ${pct(c.correctIdentification)}, wrong person ${pct(c.wrongIdentification)}, false rejection ${pct(c.falseRejection)}, unknown rejected ${pct(c.unknownRejection)}`, '');
    md.push('| threshold | FAR | FRR | TAR | 1:N correct | 1:N wrong | unknown rejected |', '|---|---|---|---|---|---|---|');
    r.verification.forEach((v, i) => {
      const id = r.identification[i];
      md.push(`| ${v.threshold} | ${pct(v.FAR)} | ${pct(v.FRR)} | ${pct(v.TAR)} | ${pct(id.correctIdentification)} | ${pct(id.wrongIdentification)} | ${pct(id.unknownRejection)} |`);
    });
    md.push('');
    md.push(
      r.recommendedThreshold != null
        ? `**Recommended RECOGNITION_THRESHOLD ≈ ${r.recommendedThreshold}** (largest threshold with zero observed false accepts is ${r.maxThresholdWithZeroObservedFalseAccepts}, minus a 0.04 safety margin). With ${r.impostor.n} impostor comparisons the 95% upper bound on FAR is still ~${pct(r.farUpperBound95)} — collect more data to tighten it.`
        : '**No threshold in range had zero false accepts — do not deploy; improve enrollment quality and investigate.**',
      ''
    );
  }
  const mdPath = path.join(outDir, `recognition-${stamp}.md`);
  fs.writeFileSync(mdPath, md.join('\n'));
  console.log(md.join('\n'));
  console.log(`\nReport written to ${mdPath}`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
