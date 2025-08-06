const faceapi = require('face-api.js');
const path = require('path');
const canvas = require('canvas');
const { Canvas, Image, ImageData } = canvas;

faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const MODEL_PATH = path.join(__dirname, '../models');

async function loadModels() {
  console.log("Loading models from local disk...");
  await faceapi.nets.tinyFaceDetector.loadFromDisk(MODEL_PATH);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH);
  console.log("✅ Models loaded successfully!");
}

const detectionOptions = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,
  scoreThreshold: 0.5,
});

async function getFaceDescriptor(imageBuffer) {
  const img = await canvas.loadImage(imageBuffer);
  const detection = await faceapi
    .detectSingleFace(img, detectionOptions)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) throw new Error('No face detected in the image');
  return detection.descriptor;
}

module.exports = { loadModels, getFaceDescriptor };
