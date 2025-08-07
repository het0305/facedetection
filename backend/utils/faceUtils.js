const faceapi = require('face-api.js');
const path = require('path');
const canvas = require('canvas');
const fs = require('fs');

// Patch face-api.js to use canvas in Node.js
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Path to the folder containing face-api.js models
const MODEL_PATH = path.join(__dirname, '../models');

// Options for face detection
const detectionOptions = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,
  scoreThreshold: 0.5,
});

/**
 * Load all face-api.js models from disk
 */
async function loadModels() {
  try {
    console.log("⏳ Loading face-api.js models...");
    await faceapi.nets.tinyFaceDetector.loadFromDisk(MODEL_PATH);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH);
    console.log("✅ Face recognition models loaded.");
  } catch (error) {
    console.error("❌ Failed to load face-api.js models:", error.message);
    throw error;
  }
}

/**
 * Get 128-dimensional face descriptor from an image
 * @param {string|Buffer} imagePathOrBuffer - Path to image or buffer
 * @returns {Float32Array|null} - Face descriptor
 */
async function getFaceDescriptor(imagePathOrBuffer) {
  try {
    const img = await canvas.loadImage(imagePathOrBuffer);
    const detection = await faceapi
      .detectSingleFace(img, detectionOptions)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      throw new Error('⚠ No face detected in the image');
    }

    return detection.descriptor;
  } catch (error) {
    console.error('❌ Error extracting face descriptor:', error.message);
    throw error;
  }
}

module.exports = {
  loadModels,
  getFaceDescriptor,
  detectionOptions
};
