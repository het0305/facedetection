// Face quality gate. Pure function of measurements so it is easy to test and
// to tune from the environment. Issues are ordered by what the user should fix
// first (distance before lighting before pose).
const config = require('../config');

const MESSAGES = {
  FACE_PARTIAL: 'Please center your face in the frame.',
  FACE_TOO_SMALL: 'Move closer to the camera.',
  FACE_TOO_CLOSE: 'Move back a little.',
  LOW_DETECTION_SCORE: 'Make sure your whole face is clearly visible.',
  TOO_DARK: 'Lighting is too low. Please move to a brighter area.',
  TOO_BRIGHT: 'Lighting is too bright. Avoid direct light on your face.',
  LOW_CONTRAST: 'Improve lighting. Your face is not clearly visible.',
  BLURRY: 'Image is too blurry. Please hold still.',
  POSE_ROLL: 'Please keep your head straight.',
  POSE_YAW: 'Please look directly at the camera.',
  POSE_PITCH: 'Please look straight at the camera, not up or down.',
};

const ORDER = Object.keys(MESSAGES);

/**
 * @param {object} m measurements
 * @param {{x,y,width,height}} m.box face box in image pixels
 * @param {number} m.score detector score
 * @param {{yaw,rollDeg,pitch}} m.pose
 * @param {{brightness,contrast,overexposed,sharpness}} m.pixels
 * @param {number} m.imageWidth
 * @param {number} m.imageHeight
 * @param {'recognition'|'enrollment'|'challenge'} mode
 */
function assessQuality(m, mode = 'recognition', cfg = config) {
  const issues = [];
  const { box, pose, pixels } = m;
  const faceSize = Math.min(box.width, box.height);
  const minSize = mode === 'enrollment' ? cfg.ENROLL_MIN_FACE_SIZE_PX : cfg.MIN_FACE_SIZE_PX;

  const margin = 0.02 * Math.min(m.imageWidth, m.imageHeight);
  if (
    box.x < -margin ||
    box.y < -margin ||
    box.x + box.width > m.imageWidth + margin ||
    box.y + box.height > m.imageHeight + margin
  ) {
    issues.push('FACE_PARTIAL');
  }
  if (faceSize < minSize) issues.push('FACE_TOO_SMALL');
  if (box.height > cfg.MAX_FACE_FRAME_RATIO * m.imageHeight) issues.push('FACE_TOO_CLOSE');
  if (m.score < cfg.MIN_DETECTION_SCORE) issues.push('LOW_DETECTION_SCORE');

  if (pixels.brightness < cfg.MIN_BRIGHTNESS) issues.push('TOO_DARK');
  else if (pixels.brightness > cfg.MAX_BRIGHTNESS || pixels.overexposed > cfg.MAX_OVEREXPOSED_RATIO) {
    issues.push('TOO_BRIGHT');
  } else if (pixels.contrast < cfg.MIN_CONTRAST) issues.push('LOW_CONTRAST');
  if (pixels.sharpness < cfg.MIN_SHARPNESS) issues.push('BLURRY');

  if (Math.abs(pose.rollDeg) > cfg.MAX_ROLL_DEG) issues.push('POSE_ROLL');
  // Enrollment checks yaw against the requested pose separately; challenge
  // frames are expected to be turned.
  const maxYaw = mode === 'challenge' ? 0.9 : mode === 'enrollment' ? 0.7 : cfg.MAX_YAW;
  if (Math.abs(pose.yaw) > maxYaw) issues.push('POSE_YAW');
  if (mode !== 'challenge' && (pose.pitch < cfg.MIN_PITCH_RATIO || pose.pitch > cfg.MAX_PITCH_RATIO)) {
    issues.push('POSE_PITCH');
  }

  issues.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return {
    ok: issues.length === 0,
    issues,
    message: issues.length ? MESSAGES[issues[0]] : null,
    metrics: {
      faceSize: Math.round(faceSize),
      score: round(m.score),
      yaw: round(pose.yaw),
      rollDeg: round(pose.rollDeg, 1),
      pitch: round(pose.pitch),
      brightness: round(pixels.brightness, 1),
      contrast: round(pixels.contrast, 1),
      sharpness: round(pixels.sharpness, 1),
    },
  };
}

// Enrollment poses. "left"/"right" are the subject's own left/right.
const POSES = {
  front: { label: 'Look straight at the camera', test: (yaw, c) => Math.abs(yaw) <= c.MAX_YAW },
  left: { label: 'Turn your head slightly to your left', test: (yaw) => yaw >= 0.15 && yaw <= 0.65 },
  right: { label: 'Turn your head slightly to your right', test: (yaw) => yaw <= -0.15 && yaw >= -0.65 },
};

function checkPose(target, yaw, cfg = config) {
  const p = POSES[target];
  if (!p) return { ok: false, message: 'Unknown pose.' };
  if (p.test(yaw, cfg)) return { ok: true };
  if (target === 'front') return { ok: false, message: POSES.front.label + '.' };
  const wrongWay = target === 'left' ? yaw < -0.15 : yaw > 0.15;
  if (wrongWay) return { ok: false, message: `Other way — ${p.label.toLowerCase()}.` };
  const tooFar = Math.abs(yaw) > 0.65;
  return { ok: false, message: tooFar ? 'Turn back a little — only slightly.' : p.label + '.' };
}

const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);

module.exports = { assessQuality, checkPose, MESSAGES, POSES };
