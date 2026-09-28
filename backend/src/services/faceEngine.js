// Face engine: detection (SSD MobileNet v1), 68-point landmarks and 128-d
// descriptors via @vladmandic/face-api, plus the pixel statistics used by the
// quality gate and the crop used by the anti-spoofing model.
//
// Backend: native TensorFlow (tfjs-node) when it is installed, otherwise the
// portable WASM backend. All inference runs through a single queue so tensor
// memory stays bounded and concurrent requests cannot interleave.
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { decodeImage } = require('./imageDecoder');
const { headPose } = require('./faceGeometry');

let faceapi;
let tf;
let backendName;
let readyPromise;

async function initBackend() {
  if (config.FACE_BACKEND !== 'wasm') {
    try {
      faceapi = require('@vladmandic/face-api/dist/face-api.node.js');
      tf = faceapi.tf;
      await tf.ready();
      backendName = tf.getBackend();
      return;
    } catch (err) {
      if (config.FACE_BACKEND === 'node') throw err;
      logger.info('tfjs-node not available, using WASM backend');
    }
  }
  tf = require('@tensorflow/tfjs');
  const wasm = require('@tensorflow/tfjs-backend-wasm');
  faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
  const wasmDir = path.join(path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')), 'dist');
  wasm.setWasmPaths(wasmDir.replace(/\\/g, '/') + '/');
  await tf.setBackend('wasm');
  await tf.ready();
  backendName = 'wasm';
}

function init() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const started = Date.now();
      await initBackend();
      const modelDir = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir);
      logger.info('Face engine ready', { backend: backendName, ms: Date.now() - started });
    })();
  }
  return readyPromise;
}

// ---- serial execution queue -------------------------------------------------
let tail = Promise.resolve();
function enqueue(fn) {
  const run = tail.then(fn, fn);
  tail = run.catch(() => {});
  return run;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

class FrameImage {
  constructor(tensor, width, height, scale) {
    this.tensor = tensor;
    this.width = width;
    this.height = height;
    this.scale = scale; // processed / original
  }

  async detect() {
    const options = new faceapi.SsdMobilenetv1Options({
      minConfidence: config.DETECTOR_MIN_CONFIDENCE,
      maxResults: 10,
    });
    const results = await faceapi.detectAllFaces(this.tensor, options).withFaceLandmarks();
    return results
      .map((r) => {
        const b = r.detection.box;
        const landmarks = r.landmarks.positions.map((p) => ({ x: p.x, y: p.y }));
        return {
          box: { x: b.x, y: b.y, width: b.width, height: b.height },
          score: r.detection.score,
          landmarks,
          pose: headPose(landmarks),
          _alignedRect: r.alignedRect,
        };
      })
      .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
  }

  normBox(box) {
    return [
      clamp(box.y / this.height, 0, 1),
      clamp(box.x / this.width, 0, 1),
      clamp((box.y + box.height) / this.height, 0, 1),
      clamp((box.x + box.width) / this.width, 0, 1),
    ];
  }

  /** Brightness/contrast/over-exposure/sharpness of the face region, normalised to 112x112. */
  pixelStats(box) {
    const out = tf.tidy(() => {
      const img = this.tensor.toFloat().expandDims(0);
      const crop = tf.image.cropAndResize(img, [this.normBox(box)], [0], [112, 112]);
      const gray = crop.mul(tf.tensor1d([0.299, 0.587, 0.114])).sum(-1, true); // [1,112,112,1]
      const { mean, variance } = tf.moments(gray);
      const over = gray.greater(250).toFloat().mean();
      const kernel = tf.tensor4d([0, 1, 0, 1, -4, 1, 0, 1, 0], [3, 3, 1, 1]);
      const lap = tf.conv2d(gray, kernel, 1, 'valid');
      const lapVar = tf.moments(lap).variance;
      return tf.stack([mean, variance.sqrt(), over, lapVar]);
    });
    const [brightness, contrast, overexposed, sharpness] = out.dataSync();
    out.dispose();
    return { brightness, contrast, overexposed, sharpness };
  }

  async descriptor(face) {
    const [faceTensor] = await faceapi.extractFaceTensors(this.tensor, [face._alignedRect]);
    try {
      const d = await faceapi.computeFaceDescriptor(faceTensor);
      return Float32Array.from(d);
    } finally {
      faceTensor.dispose();
    }
  }

  /**
   * Anti-spoof model input (Silent-Face MiniFASNet convention): a crop `scale`
   * times the face box, centred and clamped to the image, resized to size x
   * size, BGR channel order, raw 0-255 values, NCHW layout.
   */
  antispoofInput(box, scale, size = 80) {
    const s = Math.min((this.height - 1) / box.height, (this.width - 1) / box.width, scale);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const w = box.width * s;
    const h = box.height * s;
    const x1 = clamp(cx - w / 2, 0, this.width - 1);
    const y1 = clamp(cy - h / 2, 0, this.height - 1);
    const x2 = clamp(cx + w / 2, 0, this.width - 1);
    const y2 = clamp(cy + h / 2, 0, this.height - 1);
    const t = tf.tidy(() => {
      const img = this.tensor.toFloat().expandDims(0);
      const crop = tf.image.cropAndResize(
        img,
        [[y1 / (this.height - 1), x1 / (this.width - 1), y2 / (this.height - 1), x2 / (this.width - 1)]],
        [0],
        [size, size]
      );
      return crop.reverse(-1).transpose([0, 3, 1, 2]); // RGB->BGR, NHWC->NCHW
    });
    const data = t.dataSync();
    t.dispose();
    return Float32Array.from(data);
  }
}

/**
 * Decode an uploaded image and run `fn(frame)` with exclusive access to the
 * engine. All tensors are released afterwards.
 */
async function withImage(buffer, fn) {
  await init();
  const decoded = decodeImage(buffer);
  return enqueue(async () => {
    let tensor = tf.tensor3d(decoded.data, [decoded.height, decoded.width, 3], 'int32');
    let { width, height } = decoded;
    let scale = 1;
    const maxDim = Math.max(width, height);
    if (maxDim > config.MAX_PROCESS_DIMENSION) {
      scale = config.MAX_PROCESS_DIMENSION / maxDim;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const resized = tf.tidy(() => tf.image.resizeBilinear(tensor, [height, width]).round().toInt());
      tensor.dispose();
      tensor = resized;
    }
    try {
      return await fn(new FrameImage(tensor, width, height, scale));
    } finally {
      tensor.dispose();
    }
  });
}

const status = () => ({ backend: backendName || null, ready: !!backendName });
const memory = () => (tf ? tf.memory() : null);

module.exports = { init, withImage, status, memory };
