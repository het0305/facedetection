const mongoose = require('mongoose');

// A kiosk device authorised by an admin to submit attendance scans.
const deviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    lastSeenAt: Date,
  },
  { timestamps: true }
);

deviceSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.models.Device || mongoose.model('Device', deviceSchema);
