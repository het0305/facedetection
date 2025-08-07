const faceapi = require('face-api.js');
const path = require('path');
const canvas = require('canvas');
const fs = require('fs');

const { Canvas, Image, ImageData } = canvas;

// Monkey patch canvas
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const MODEL_PATH = path.join(__dirname, '../models');

// ✅ Load models safely
async function loadModels() {
  try {
    console.log("⏳ Loading face-api.js models...");
    await faceapi.nets.tinyFaceDetector.loadFromDisk(MODEL_PATH);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH);
    console.log("✅ Face recognition models loaded.");
  } catch (error) {
    console.error("❌ Failed to load models:", error.message);
    throw error;
  }
}

// ✅ Detection config
const detectionOptions = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,
  scoreThreshold: 0.5,
});

// ✅ Extract 128-d descriptor from face image buffer
async function getFaceDescriptor(imageBuffer) {
  try {
    const img = await canvas.loadImage(imageBuffer);
    const detection = await faceapi
      .detectSingleFace(img, detectionOptions)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      throw new Error('⚠ No face detected in the image');
    }

    return detection.descriptor;
  } catch (err) {
    console.error("❌ Face descriptor error:", err.message);
    throw err;
  }
}

module.exports = {
  loadModels,
  getFaceDescriptor,
  detectionOptions,
};
