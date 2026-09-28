// Decodes untrusted uploads into raw RGB pixels.
// - The file type is decided by magic bytes, never by name or client MIME type.
// - Pure-JS decoders (memory safe) with resolution and memory caps protect
//   against decompression bombs.
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const config = require('../config');
const { badRequest } = require('../utils/errors');

const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b) =>
  b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a;

function detectType(buffer) {
  if (isJpeg(buffer)) return 'jpeg';
  if (isPng(buffer)) return 'png';
  return null;
}

// PNG dimensions live in the IHDR chunk; check them before inflating anything.
function pngDimensions(buffer) {
  if (buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const invalid = () => badRequest('INVALID_IMAGE', 'The image could not be read. Please capture it again.');

function checkDimensions(width, height) {
  if (!width || !height) throw invalid();
  if (width > config.MAX_IMAGE_DIMENSION || height > config.MAX_IMAGE_DIMENSION) {
    throw badRequest('IMAGE_TOO_LARGE', 'The image resolution is too large.');
  }
  if (width < config.MIN_IMAGE_DIMENSION || height < config.MIN_IMAGE_DIMENSION) {
    throw badRequest('IMAGE_TOO_SMALL', 'The image resolution is too low. Please use a better camera setting.');
  }
}

/** @returns {{width:number,height:number,data:Uint8Array}} tightly packed RGB */
function decodeImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw invalid();
  const type = detectType(buffer);
  if (!type) throw badRequest('UNSUPPORTED_IMAGE', 'Only JPEG or PNG images are supported.');

  if (type === 'jpeg') {
    let raw;
    try {
      raw = jpeg.decode(buffer, {
        useTArray: true,
        formatAsRGBA: false,
        maxResolutionInMP: Math.ceil((config.MAX_IMAGE_DIMENSION ** 2) / 1e6),
        maxMemoryUsageInMB: 256,
      });
    } catch {
      throw invalid();
    }
    checkDimensions(raw.width, raw.height);
    return { width: raw.width, height: raw.height, data: raw.data };
  }

  const dims = pngDimensions(buffer);
  if (!dims) throw invalid();
  checkDimensions(dims.width, dims.height);
  let png;
  try {
    png = PNG.sync.read(buffer);
  } catch {
    throw invalid();
  }
  const { width, height, data } = png; // RGBA
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  return { width, height, data: rgb };
}

module.exports = { decodeImage, detectType };
