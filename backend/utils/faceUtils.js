const faceapi = require('face-api.js');
const canvas = require('canvas');
const path = require('path');

const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const MODEL_PATH = path.join(__dirname, '../../models');

async function loadModels() {
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_PATH);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH);
}

async function getFaceDescriptor(imageBuffer) {
  const img = await canvas.loadImage(imageBuffer);
  const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
  if (!detection) throw new Error('No face detected');
  return detection.descriptor;
}

module.exports = { loadModels, getFaceDescriptor };
