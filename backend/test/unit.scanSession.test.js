require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { descriptor } = require('./helpers');
const config = require('../src/config');
const { ScanSession } = require('../src/services/scanSession');
const { Challenge } = require('../src/services/liveness');

const cfg = {
  ...config,
  LIVENESS_ENABLED: true,
  LIVENESS_THRESHOLD: 0.6,
  LIVENESS_HARD_FAIL: 0.2,
  LIVENESS_MIN_FRAMES: 3,
  LIVENESS_MAX_FRAMES: 8,
  CHALLENGE_ENABLED: true,
  CHALLENGE_TYPES: ['turn_left'],
  CHALLENGE_TIMEOUT_MS: 8000,
  CHALLENGE_TURN_DELTA: 0.25,
  STABLE_FRAMES: 3,
  UNKNOWN_AFTER_FRAMES: 4,
  SCAN_SESSION_TIMEOUT_MS: 25000,
  HIGH_CONFIDENCE_THRESHOLD: 0.4,
};

const ALICE = { id: 'alice', name: 'Alice', rollNo: 'A1' };
const BOB = { id: 'bob', name: 'Bob', rollNo: 'B1' };

function frame({ seed = 1, noise = 0.02, n = 1, liveness = 0.95, yaw = 0, ear = 0.28, ok = true, box } = {}) {
  if (n === 0) return { faceCount: 0, face: null };
  if (n > 1) return { faceCount: n, face: null };
  return {
    faceCount: 1,
    face: {
      normBox: box || { x: 0.3, y: 0.2, width: 0.3, height: 0.4 },
      pose: { yaw, rollDeg: 0, pitch: 0.36, ear },
      quality: ok ? { ok: true, issues: [] } : { ok: false, issues: ['TOO_DARK'], message: 'Lighting is too low.' },
      liveness,
      descriptor: descriptor(seed, noise, Math.floor(Math.random() * 1000)),
    },
  };
}

function setup({ matchFn, markStatus = 'MARKED', clock } = {}) {
  const calls = { mark: [], security: [] };
  let t = 0;
  const deps = {
    match:
      matchFn ||
      (async (d) => {
        // seed 1 => Alice, seed 2 => Bob, anything else unknown
        const a = require('../src/services/matcher').euclidean(d, descriptor(1));
        const b = require('../src/services/matcher').euclidean(d, descriptor(2));
        if (a < 0.4) return { accepted: true, id: 'alice', person: ALICE, distance: a, reason: 'OK' };
        if (b < 0.4) return { accepted: true, id: 'bob', person: BOB, distance: b, reason: 'OK' };
        return { accepted: false, reason: 'NO_MATCH', distance: Math.min(a, b) };
      }),
    mark: async (args) => {
      calls.mark.push(args);
      return { status: markStatus, record: { checkInAt: new Date(), status: 'Present' } };
    },
    onSecurityEvent: (e, d) => calls.security.push({ e, d }),
  };
  const s = new ScanSession({
    owner: 'device:1',
    deps,
    cfg,
    now: clock || (() => (t += 300)),
    random: () => 'turn_left',
  });
  return { s, calls };
}

async function run(s, frames) {
  let out;
  for (const f of frames) out = await s.step(f);
  return out;
}

test('happy path: stable identity + liveness + challenge + confirm marks once', async () => {
  const { s, calls } = setup();
  let out = await run(s, [frame(), frame(), frame()]);
  assert.equal(out.state, 'CHALLENGE');
  assert.match(out.message, /turn your head slightly to your left/);
  out = await s.step(frame({ yaw: 0.4 }));
  assert.equal(out.state, 'CHALLENGE');
  assert.match(out.message, /look back/);
  out = await s.step(frame({ yaw: 0.02 }));
  assert.equal(out.state, 'VERIFYING');
  out = await s.step(frame());
  assert.equal(out.state, 'MARKED');
  assert.equal(out.terminal, true);
  assert.equal(out.result.name, 'Alice');
  assert.equal(calls.mark.length, 1);
  assert.equal(calls.mark[0].verification.challenge, 'turn_left');
  // A finished session keeps returning the same result and never marks again.
  assert.equal((await s.step(frame())).state, 'MARKED');
  assert.equal(calls.mark.length, 1);
});

test('a static photo (no head movement) cannot complete the challenge', async () => {
  let t = 0;
  const { s, calls } = setup({ clock: () => (t += 1000) });
  const frames = Array.from({ length: 12 }, () => frame());
  const out = await run(s, frames);
  assert.equal(out.state, 'LIVENESS_FAILED');
  assert.equal(calls.mark.length, 0);
  assert.equal(calls.security.length, 1);
});

test('unknown person is rejected and never marked', async () => {
  const { s, calls } = setup();
  const out = await run(s, Array.from({ length: 4 }, () => frame({ seed: 7 })));
  assert.equal(out.state, 'UNKNOWN');
  assert.equal(out.message, 'Face not recognized.');
  assert.equal(calls.mark.length, 0);
});

test('ambiguous identity reports "unable to verify"', async () => {
  const { s } = setup({ matchFn: async () => ({ accepted: false, reason: 'AMBIGUOUS', distance: 0.3 }) });
  const out = await run(s, Array.from({ length: 4 }, () => frame()));
  assert.equal(out.state, 'UNVERIFIED');
});

test('low passive liveness ends as spoof and raises a security event', async () => {
  const { s, calls } = setup();
  const out = await run(s, [frame({ liveness: 0.1 }), frame({ liveness: 0.1 })]);
  assert.equal(out.state, 'SPOOF');
  assert.equal(calls.mark.length, 0);
  assert.equal(calls.security[0].e, 'liveness.spoof_suspected');
});

test('borderline liveness keeps checking and then fails', async () => {
  const { s, calls } = setup();
  const out = await run(s, Array.from({ length: 8 }, () => frame({ liveness: 0.45 })));
  assert.equal(out.state, 'SPOOF');
  assert.equal(calls.mark.length, 0);
});

test('multiple faces reset progress', async () => {
  const { s } = setup();
  await run(s, [frame(), frame()]);
  assert.equal((await s.step(frame({ n: 2 }))).state, 'MULTIPLE_FACES');
  assert.equal(s.candidate, null);
  // needs a full new stable run
  assert.equal((await run(s, [frame(), frame()])).state, 'VERIFYING');
});

test('identity switching between frames never combines two people', async () => {
  const { s, calls } = setup();
  await run(s, [frame({ seed: 1 }), frame({ seed: 1 })]);
  // Different person steps in at the same spot (same box): descriptor drift resets.
  await s.step(frame({ seed: 2 }));
  assert.ok(!s.candidate || s.candidate.id !== 'alice' || s.candidate.hits === 0);
  const out = await run(s, [frame({ seed: 2 }), frame({ seed: 2 }), frame({ seed: 2 })]);
  assert.equal(out.state, 'CHALLENGE');
  assert.equal(s.candidate.id, 'bob');
  assert.equal(calls.mark.length, 0);
});

test('track break (face jumps) resets progress', async () => {
  const { s } = setup();
  await run(s, [frame(), frame()]);
  await s.step(frame({ box: { x: 0.0, y: 0.0, width: 0.1, height: 0.1 } }));
  assert.equal(s.candidate.hits, 1);
});

test('poor quality frames are not counted and give guidance', async () => {
  const { s } = setup();
  const out = await s.step(frame({ ok: false }));
  assert.equal(out.state, 'QUALITY');
  assert.equal(out.message, 'Lighting is too low.');
  assert.equal(s.candidate, null);
});

test('different person during challenge ends as unverified', async () => {
  const { s, calls } = setup();
  await run(s, [frame(), frame(), frame()]);
  const out = await s.step(frame({ seed: 2, yaw: 0.4 }));
  assert.equal(out.state, 'UNVERIFIED');
  assert.equal(calls.mark.length, 0);
});

test('session timeout', async () => {
  let t = 0;
  const { s } = setup({ clock: () => (t += 30000) });
  assert.equal((await s.step(frame())).state, 'TIMEOUT');
});

test('already marked is reported, database errors are friendly', async () => {
  const a = setup({ markStatus: 'ALREADY_MARKED' });
  const out = await run(a.s, [frame(), frame(), frame(), frame({ yaw: 0.4 }), frame(), frame()]);
  assert.equal(out.state, 'ALREADY_MARKED');

  const b = setup();
  b.s.deps.mark = async () => {
    throw new Error('db down');
  };
  const out2 = await run(b.s, [frame(), frame(), frame(), frame({ yaw: 0.4 }), frame(), frame()]);
  assert.equal(out2.state, 'ERROR');
  assert.match(out2.message, /Something went wrong while recording attendance/);
});

test('challenge: wrong direction three times fails; blink works', () => {
  const c = new Challenge('turn_right', { yaw: 0, ear: 0.28 }, cfg, 0);
  c.update({ yaw: 0.4 });
  assert.match(c.message, /Other way/);
  c.update({ yaw: 0.4 });
  assert.equal(c.update({ yaw: 0.4 }), 'failed');

  const b = new Challenge('blink', { yaw: 0, ear: 0.28 }, { ...cfg, CHALLENGE_BLINK_RATIO: 0.65 }, 0);
  assert.equal(b.update({ yaw: 0, ear: 0.27 }), 'waiting');
  assert.equal(b.update({ yaw: 0, ear: 0.1 }), 'performed');
  assert.equal(b.update({ yaw: 0, ear: 0.27 }), 'done');
  assert.equal(new Challenge('blink', { yaw: 0, ear: 0.28 }, cfg, 0).expired(9000), true);
});
