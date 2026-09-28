// Uploads are kept in memory only (never written to disk) and size-limited.
// Content is validated later in imageDecoder by magic bytes; the MIME filter
// here is only a cheap first rejection.
const multer = require('multer');
const config = require('../config');
const { badRequest } = require('../utils/errors');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.MAX_UPLOAD_BYTES,
    files: config.ENROLL_MAX_SAMPLES,
    fields: 20,
    fieldSize: 16 * 1024,
    parts: 40,
  },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png)$/.test(file.mimetype)) return cb(null, true);
    cb(badRequest('UNSUPPORTED_IMAGE', 'Only JPEG or PNG images are supported.'));
  },
});

module.exports = { upload };
