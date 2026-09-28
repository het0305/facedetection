require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { descriptor, frontalLandmarks } = require('./helpers');
const config = require('../src/config');
const matcher = require('../src/services/matcher');
const { headPose, iou } = require('../src/services/faceGeometry');
const { assessQuality, checkPose } = require('../src/services/quality');

const cfg = { ...config, RECOGNITION_THRESHOLD: 0.5, HIGH_CONFIDENCE_THRESHOLD: 0.4, RECOGNITION_MIN_MARGIN: 0.06, MATCH_STRATEGY: 'min' };

test('synthetic descriptors behave like face embeddings', () => {
  assert.ok(matcher.euclidean(descriptor(1), descriptor(2)) > 0.7, 'different people are far apart');
  assert.ok(matcher.euclidean(descriptor(1), descriptor(1, 0.06, 5)) < 0.4, 'same person is close');
});

test('matcher accepts a clear match and reports confidence', () => {
  const people = [
    { id: 'a', descriptors: [descriptor(1), descriptor(1, 0.05, 2)] },
    { id: 'b', descriptors: [descriptor(2)] },
  ];
  const r = matcher.match(descriptor(1, 0.05, 9), people, cfg);
  assert.equal(r.accepted, true);
  assert.equal(r.id, 'a');
  assert.equal(r.reason, 'OK');
  assert.ok(['high', 'standard'].includes(r.confidence));
});

test('matcher rejects an unknown person instead of picking the nearest', () => {
  const people = [
    { id: 'a', descriptors: [descriptor(1)] },
    { id: 'b', descriptors: [descriptor(2)] },
  ];
  const r = matcher.match(descriptor(3), people, cfg);
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'NO_MATCH');
});

test('matcher rejects ambiguous matches between two similar people', () => {
  // Same underlying face registered as two identities (the duplicate problem found in the audit).
  const people = [
    { id: 'a', descriptors: [descriptor(1, 0.03, 1)] },
    { id: 'b', descriptors: [descriptor(1, 0.03, 2)] },
  ];
  const r = matcher.match(descriptor(1, 0.03, 3), people, cfg);
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'AMBIGUOUS');
});

test('matcher handles an empty gallery', () => {
  assert.equal(matcher.match(descriptor(1), [], cfg).reason, 'EMPTY_GALLERY');
});

test('centroid strategy uses the averaged template', () => {
  const people = [{ id: 'a', descriptors: [descriptor(1, 0.05, 1), descriptor(1, 0.05, 2)] }];
  const r = matcher.match(descriptor(1, 0.05, 3), people, { ...cfg, MATCH_STRATEGY: 'centroid' });
  assert.equal(r.accepted, true);
});

test('findSimilar and maxPairwise', () => {
  const people = [
    { id: 'a', descriptors: [descriptor(1)] },
    { id: 'b', descriptors: [descriptor(2)] },
  ];
  const hits = matcher.findSimilar([descriptor(1, 0.04, 7)], people, 0.42);
  assert.deepEqual(hits.map((h) => h.id), ['a']);
  assert.ok(matcher.maxPairwise([descriptor(1), descriptor(2)]) > 0.7);
});

test('head pose: frontal, turned, rolled, eyes closed', () => {
  const f = headPose(frontalLandmarks());
  assert.ok(Math.abs(f.yaw) < 0.05);
  assert.ok(Math.abs(f.rollDeg) < 1);
  assert.ok(f.ear > 0.2);
  // Nose moves to image-right => subject turned to THEIR left => positive yaw.
  assert.ok(headPose(frontalLandmarks({ noseShift: 0.2 })).yaw > 0.3);
  assert.ok(headPose(frontalLandmarks({ noseShift: -0.2 })).yaw < -0.3);
  assert.ok(Math.abs(headPose(frontalLandmarks({ roll: 25 })).rollDeg) > 15);
  assert.ok(headPose(frontalLandmarks({ eyeOpen: 0.2 })).ear < f.ear * 0.5);
  assert.throws(() => headPose([]));
});

test('iou', () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(iou(a, a), 1);
  assert.equal(iou(a, { x: 20, y: 20, width: 5, height: 5 }), 0);
});

const good = {
  box: { x: 100, y: 80, width: 150, height: 170 },
  score: 0.99,
  pose: { yaw: 0.02, rollDeg: 1, pitch: 0.36 },
  pixels: { brightness: 110, contrast: 40, overexposed: 0.01, sharpness: 80 },
  imageWidth: 640,
  imageHeight: 480,
};
const withChange = (patch) => ({
  ...good,
  ...patch,
  pose: { ...good.pose, ...(patch.pose || {}) },
  pixels: { ...good.pixels, ...(patch.pixels || {}) },
});

test('quality gate accepts a good face', () => {
  const q = assessQuality(good, 'recognition');
  assert.equal(q.ok, true, q.issues.join());
});

test('quality gate reports actionable problems', () => {
  const cases = [
    [{ box: { x: 300, y: 200, width: 50, height: 60 } }, 'FACE_TOO_SMALL', 'Move closer to the camera.'],
    [{ pixels: { brightness: 20 } }, 'TOO_DARK', /Lighting is too low/],
    [{ pixels: { brightness: 240 } }, 'TOO_BRIGHT', /too bright/],
    [{ pixels: { sharpness: 3 } }, 'BLURRY', 'Image is too blurry. Please hold still.'],
    [{ pose: { yaw: 0.6 } }, 'POSE_YAW', 'Please look directly at the camera.'],
    [{ pose: { rollDeg: 40 } }, 'POSE_ROLL', /head straight/],
    [{ score: 0.55 }, 'LOW_DETECTION_SCORE', /clearly visible/],
    [{ box: { x: 560, y: 80, width: 150, height: 170 } }, 'FACE_PARTIAL', /center your face/],
    [{ box: { x: 100, y: 0, width: 400, height: 460 } }, 'FACE_TOO_CLOSE', /Move back/],
  ];
  for (const [patch, code, msg] of cases) {
    const q = assessQuality(withChange(patch), 'recognition');
    assert.equal(q.ok, false, code);
    assert.ok(q.issues.includes(code), `${code} in ${q.issues}`);
    if (q.issues[0] === code) assert.match(q.message, msg instanceof RegExp ? msg : new RegExp(msg.replace(/[.?]/g, '\\$&')));
  }
});

test('enrollment requires larger faces; challenge allows turned faces', () => {
  assert.equal(assessQuality(withChange({ box: { x: 100, y: 80, width: 100, height: 110 } }), 'enrollment').ok, false);
  assert.equal(assessQuality(withChange({ pose: { yaw: 0.6 } }), 'challenge').ok, true);
});

test('enrollment pose guidance', () => {
  assert.equal(checkPose('front', 0.05).ok, true);
  assert.equal(checkPose('left', 0.3).ok, true);
  assert.equal(checkPose('right', -0.3).ok, true);
  assert.match(checkPose('left', -0.3).message, /Other way/);
  assert.match(checkPose('right', -0.9).message, /only slightly/);
  assert.equal(checkPose('front', 0.5).ok, false);
});
