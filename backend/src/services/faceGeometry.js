// Head-pose and eye-openness estimates from the 68-point landmark layout
// (iBUG 300-W): jaw 0-16, nose 27-35 (tip 30), eyes 36-41 / 42-47, chin 8.
// Coordinates are in the un-mirrored camera image.

const mean = (pts) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function eyeAspectRatio(eye) {
  // eye = 6 points p1..p6 (corner, top, top, corner, bottom, bottom)
  const horizontal = dist(eye[0], eye[3]);
  if (horizontal === 0) return 0;
  return (dist(eye[1], eye[5]) + dist(eye[2], eye[4])) / (2 * horizontal);
}

/**
 * @param {{x:number,y:number}[]} lm 68 landmarks
 * @returns {{yaw:number, rollDeg:number, pitch:number, ear:number}}
 *   yaw   -1..1, 0 = frontal, positive = subject turned towards THEIR left
 *         (their nose moves to the right side of the un-mirrored image)
 *   pitch nose-tip height between eye line (0) and chin (1); ~0.4 frontal
 *   ear   mean eye aspect ratio; ~0.25-0.35 open, <0.18 closed
 */
function headPose(lm) {
  if (!Array.isArray(lm) || lm.length !== 68) throw new Error('Expected 68 landmarks');
  const rightEye = lm.slice(36, 42); // subject's right eye (image left)
  const leftEye = lm.slice(42, 48);
  const re = mean(rightEye);
  const le = mean(leftEye);

  const rollDeg = (Math.atan2(le.y - re.y, le.x - re.x) * 180) / Math.PI;

  const jawL = lm[0];
  const jawR = lm[16];
  const nose = lm[30];
  const span = jawR.x - jawL.x;
  const yaw = span > 0 ? Math.max(-1, Math.min(1, ((nose.x - jawL.x) / span - 0.5) * 2)) : 0;

  const eyeMidY = (re.y + le.y) / 2;
  const chinSpan = lm[8].y - eyeMidY;
  const pitch = chinSpan > 0 ? (nose.y - eyeMidY) / chinSpan : 0;

  const ear = (eyeAspectRatio(rightEye) + eyeAspectRatio(leftEye)) / 2;
  return { yaw, rollDeg, pitch, ear };
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

module.exports = { headPose, eyeAspectRatio, iou };
