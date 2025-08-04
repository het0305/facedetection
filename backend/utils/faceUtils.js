const faceapi = require('face-api.js');
const path = require('path');
const { Canvas, Image, ImageData } = require('canvas');

faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Absolute path to models folder
const MODEL_PATH = path.join(__dirname, '../../models');

async function loadModels() {
  console.log("Loading models from local disk...");
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_PATH);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH);
  console.log("✅ Models loaded successfully!");
}

module.exports = { loadModels };
