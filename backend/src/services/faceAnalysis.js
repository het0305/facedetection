// One pass over an uploaded frame: detect -> count faces -> quality ->
// (optionally) passive liveness and descriptor for the single valid face.
// Expensive steps are skipped as soon as the frame is known to be unusable.
const config = require('../config');
const engine = require('./faceEngine');
const liveness = require('./liveness');
const { assessQuality } = require('./quality');

/**
 * @param {Buffer} buffer
 * @param {object} opts
 * @param {'recognition'|'enrollment'|'challenge'} opts.mode
 * @param {boolean} [opts.descriptor=true]
 * @param {boolean} [opts.liveness=true]
 */
async function analyzeFrame(buffer, { mode = 'recognition', descriptor = true, liveness: withLiveness = true } = {}) {
  return engine.withImage(buffer, async (frame) => {
    const all = await frame.detect();
    // Tiny faces far in the background are ignored during attendance, but any
    // second face blocks enrollment.
    const minSide = mode === 'enrollment' ? 40 : 0.6 * config.MIN_FACE_SIZE_PX;
    const faces = all.filter((f) => Math.min(f.box.width, f.box.height) >= minSide);
    const result = {
      width: frame.width,
      height: frame.height,
      faceCount: faces.length,
      face: null,
    };
    if (faces.length !== 1) return result;

    const f = faces[0];
    const pixels = frame.pixelStats(f.box);
    const quality = assessQuality(
      { box: f.box, score: f.score, pose: f.pose, pixels, imageWidth: frame.width, imageHeight: frame.height },
      mode
    );
    const face = {
      box: f.box,
      normBox: {
        x: f.box.x / frame.width,
        y: f.box.y / frame.height,
        width: f.box.width / frame.width,
        height: f.box.height / frame.height,
      },
      score: f.score,
      pose: f.pose,
      quality,
      liveness: null,
      descriptor: null,
    };
    result.face = face;
    if (!quality.ok) return result;
    if (withLiveness) face.liveness = await liveness.passiveScore(frame, f.box);
    if (descriptor) face.descriptor = await frame.descriptor(f);
    return result;
  });
}

module.exports = { analyzeFrame };
