const mongoose = require('mongoose');

// One biometric sample = one encrypted 128-d descriptor plus the capture
// metadata needed to judge its quality later. Raw images are never stored.
const sampleSchema = new mongoose.Schema(
  {
    enc: { type: Buffer, required: true },
    pose: { type: String, default: 'front' },
    quality: {
      sharpness: Number,
      brightness: Number,
      yaw: Number,
      faceSize: Number,
    },
    liveness: Number,
    legacy: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const studentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    rollNo: { type: String, required: true, trim: true, maxlength: 32, unique: true },
    active: { type: Boolean, default: true, index: true },
    // select:false keeps biometric data out of every query unless a service
    // explicitly asks for it with .select('+samples').
    samples: { type: [sampleSchema], select: false, default: [] },
    sampleCount: { type: Number, default: 0 },
    hasLegacySample: { type: Boolean, default: false },
  },
  { timestamps: true }
);

studentSchema.index({ name: 1 });

studentSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.samples;
    delete ret.embeddings;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.models.Student || mongoose.model('Student', studentSchema);
