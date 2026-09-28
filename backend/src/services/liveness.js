// Presentation-attack detection.
//
// 1. Passive: Silent-Face MiniFASNet models (Apache-2.0, minivision-ai; ONNX
//    export by yakhyo/face-anti-spoofing). Each model classifies a face crop as
//    class 1 = real, classes 0 and 2 = attack types; the ensemble score is
//    the mean "real" probability.
// 2. Active: a randomised head-turn / blink challenge verified on the server
//    from landmarks across consecutive frames, so a static photo or a replay
//    recorded without knowing the challenge fails.
//
// Neither method is perfect on a single RGB webcam; together they stop
// printed photos, phone/monitor screens and simple replays.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

const MODELS = [
  { file: 'MiniFASNetV2.onnx', scale: 2.7 },
  { file: 'MiniFASNetV1SE.onnx', scale: 4.0 },
];

let sessions = null;
let ort = null;

async function init() {
  if (!config.LIVENESS_ENABLED || sessions) return;
  ort = require('onnxruntime-node');
  const loaded = [];
  for (const m of MODELS) {
    const file = path.join(config.LIVENESS_MODEL_DIR, m.file);
    if (!fs.existsSync(file)) {
      logger.warn('Anti-spoof model missing', { file: m.file });
      continue;
    }
    const session = await ort.InferenceSession.create(file, { intraOpNumThreads: 1 });
    loaded.push({ ...m, session, input: session.inputNames[0], output: session.outputNames[0] });
  }
  if (!loaded.length) {
    throw new Error(
      `LIVENESS_ENABLED=true but no anti-spoof models found in ${config.LIVENESS_MODEL_DIR}. ` +
        'Run `npm run models` or set LIVENESS_ENABLED=false (not recommended).'
    );
  }
  sessions = loaded;
  logger.info('Liveness models ready', { models: loaded.map((m) => m.file) });
}

function softmax(values) {
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** @returns {Promise<number|null>} probability the face is live (0..1), null when disabled */
async function passiveScore(frame, box) {
  if (!config.LIVENESS_ENABLED) return null;
  await init();
  let total = 0;
  for (const m of sessions) {
    const data = frame.antispoofInput(box, m.scale, 80);
    const result = await m.session.run({ [m.input]: new ort.Tensor('float32', data, [1, 3, 80, 80]) });
    total += softmax(Array.from(result[m.output].data))[1];
  }
  return total / sessions.length;
}

// ---- active challenge ---------------------------------------------------------

const CHALLENGE_TEXT = {
  turn_left: 'Please turn your head slightly to your left.',
  turn_right: 'Please turn your head slightly to your right.',
  blink: 'Please blink slowly.',
};

class Challenge {
  /**
   * @param {string} type turn_left | turn_right | blink
   * @param {{yaw:number, ear:number}} baseline pose measured on frontal frames
   */
  constructor(type, baseline, cfg = config, now = Date.now()) {
    this.type = type;
    this.baseline = baseline;
    this.cfg = cfg;
    this.issuedAt = now;
    this.stage = 'waiting'; // waiting -> performed -> done | failed
    this.wrongWay = 0;
  }

  get message() {
    if (this.stage === 'performed') return 'Now look back at the camera.';
    if (this.wrongWay > 0 && this.type !== 'blink') return 'Other way. ' + CHALLENGE_TEXT[this.type];
    return CHALLENGE_TEXT[this.type];
  }

  expired(now = Date.now()) {
    return now - this.issuedAt > this.cfg.CHALLENGE_TIMEOUT_MS;
  }

  /** Feed one frame's pose. Returns the stage after the update. */
  update(pose) {
    if (this.stage === 'done' || this.stage === 'failed') return this.stage;
    const { yaw: y0, ear: e0 } = this.baseline;
    const delta = this.cfg.CHALLENGE_TURN_DELTA;
    if (this.type === 'blink') {
      if (this.stage === 'waiting' && pose.ear <= e0 * this.cfg.CHALLENGE_BLINK_RATIO) this.stage = 'performed';
      else if (this.stage === 'performed' && pose.ear >= e0 * 0.85) this.stage = 'done';
      return this.stage;
    }
    const sign = this.type === 'turn_left' ? 1 : -1;
    const moved = (pose.yaw - y0) * sign;
    if (this.stage === 'waiting') {
      if (moved >= delta) this.stage = 'performed';
      else if (moved <= -delta) {
        this.wrongWay += 1;
        if (this.wrongWay >= 3) this.stage = 'failed';
      }
    } else if (this.stage === 'performed' && Math.abs(pose.yaw - y0) <= delta / 2) {
      this.stage = 'done';
    }
    return this.stage;
  }
}

function randomChallengeType(types = config.CHALLENGE_TYPES) {
  return types[crypto.randomInt(types.length)];
}

const status = () => ({
  enabled: config.LIVENESS_ENABLED,
  models: sessions ? sessions.map((m) => m.file) : [],
  challenge: config.CHALLENGE_ENABLED ? config.CHALLENGE_TYPES : [],
});

module.exports = { init, passiveScore, Challenge, randomChallengeType, softmax, status, CHALLENGE_TEXT };
