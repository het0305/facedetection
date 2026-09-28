// Server-side validation of enrollment samples. The client guides the user,
// but every sample is re-checked here: exactly one face, quality gate, the
// requested pose, liveness, and that all samples belong to the same person.
const config = require('../config');
const { analyzeFrame } = require('./faceAnalysis');
const { checkPose } = require('./quality');
const { maxPairwise } = require('./matcher');
const { badRequest } = require('../utils/errors');

const VALID_POSES = ['front', 'left', 'right'];

/** Evaluate one frame for the live registration guide. Nothing is stored. */
async function checkSample(buffer, pose = 'front') {
  const a = await analyzeFrame(buffer, {
    mode: 'enrollment',
    descriptor: false,
    liveness: config.REGISTRATION_REQUIRE_LIVENESS,
  });
  return evaluate(a, pose);
}

function evaluate(a, pose) {
  if (a.faceCount === 0) return { ok: false, code: 'NO_FACE', message: 'No face detected. Look at the camera.' };
  if (a.faceCount > 1) {
    return { ok: false, code: 'MULTIPLE_FACES', message: 'Only one person should be visible during registration.' };
  }
  const f = a.face;
  const base = { face: f.normBox, metrics: f.quality.metrics };
  if (!f.quality.ok) return { ...base, ok: false, code: f.quality.issues[0], message: f.quality.message };
  const p = checkPose(pose, f.pose.yaw);
  if (!p.ok) return { ...base, ok: false, code: 'POSE', message: p.message };
  if (config.REGISTRATION_REQUIRE_LIVENESS && f.liveness != null && f.liveness < config.LIVENESS_THRESHOLD) {
    return {
      ...base,
      ok: false,
      code: 'LIVENESS',
      message: 'Unable to confirm a live person. Photos of photos or screens cannot be registered.',
    };
  }
  return { ...base, ok: true, code: 'OK', message: 'Looks good.' };
}

/**
 * @param {Buffer[]} buffers
 * @param {string[]} poses same length as buffers
 * @returns {Promise<{descriptor:Float32Array, pose:string, quality:object, liveness:number|null}[]>}
 */
async function buildSamples(buffers, poses) {
  if (buffers.length < config.ENROLL_MIN_SAMPLES) {
    throw badRequest('TOO_FEW_SAMPLES', `Please capture at least ${config.ENROLL_MIN_SAMPLES} face photos.`);
  }
  if (buffers.length > config.ENROLL_MAX_SAMPLES) {
    throw badRequest('TOO_MANY_SAMPLES', `At most ${config.ENROLL_MAX_SAMPLES} face photos are allowed.`);
  }
  if (poses.length !== buffers.length || poses.some((p) => !VALID_POSES.includes(p))) {
    throw badRequest('INVALID_POSES', 'Invalid capture data. Please restart the face capture.');
  }
  if (!poses.includes('front')) throw badRequest('INVALID_POSES', 'At least one straight-on photo is required.');

  const samples = [];
  for (let i = 0; i < buffers.length; i += 1) {
    const a = await analyzeFrame(buffers[i], {
      mode: 'enrollment',
      descriptor: true,
      liveness: config.REGISTRATION_REQUIRE_LIVENESS,
    });
    const verdict = evaluate(a, poses[i]);
    if (!verdict.ok) {
      throw badRequest('SAMPLE_REJECTED', `Photo ${i + 1}: ${verdict.message}`, { index: i, code: verdict.code });
    }
    const m = a.face.quality.metrics;
    samples.push({
      descriptor: a.face.descriptor,
      pose: poses[i],
      quality: { sharpness: m.sharpness, brightness: m.brightness, yaw: m.yaw, faceSize: m.faceSize },
      liveness: a.face.liveness,
    });
  }
  if (maxPairwise(samples.map((s) => s.descriptor)) > config.ENROLL_SAME_PERSON_THRESHOLD) {
    throw badRequest(
      'INCONSISTENT_SAMPLES',
      'The captured photos do not appear to be the same person. Please restart the face capture.'
    );
  }
  return samples;
}

module.exports = { checkSample, buildSamples, evaluate, VALID_POSES };
