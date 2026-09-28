const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    // Snapshot so history survives renames and deletions.
    studentName: { type: String, required: true },
    rollNo: { type: String, required: true },
    // Local calendar day in APP_TIMEZONE, e.g. "2026-09-28".
    dayKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    checkInAt: { type: Date, required: true },
    status: { type: String, enum: ['Present', 'Late'], default: 'Present' },
    source: { type: String, enum: ['kiosk', 'manual', 'legacy'], default: 'kiosk' },
    verification: {
      distance: Number,
      confidence: { type: String, enum: ['high', 'standard'] },
      liveness: Number,
      challenge: String,
    },
    deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' },
  },
  { timestamps: true }
);

// The database, not application code, guarantees one record per person per day.
attendanceSchema.index({ studentId: 1, dayKey: 1 }, { unique: true });
attendanceSchema.index({ dayKey: 1, checkInAt: -1 });
attendanceSchema.index({ checkInAt: -1 });

attendanceSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.models.Attendance || mongoose.model('Attendance', attendanceSchema);
