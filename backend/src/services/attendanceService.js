// Attendance rules: one check-in per person per local day (APP_TIMEZONE).
// The unique (studentId, dayKey) index makes this safe under concurrent
// requests; a short in-memory cooldown avoids hitting the DB repeatedly
// while someone keeps standing in front of the camera.
const Attendance = require('../models/Attendance');
const config = require('../config');
const { dayKeyOf, isLate } = require('../utils/time');

const recent = new Map(); // studentId -> { at, record }

function fromCooldown(studentId, now) {
  const hit = recent.get(studentId);
  if (!hit) return null;
  if (now - hit.at > config.ATTENDANCE_COOLDOWN_SEC * 1000 || hit.record.dayKey !== dayKeyOf(new Date(now))) {
    recent.delete(studentId);
    return null;
  }
  return hit.record;
}

/**
 * @returns {Promise<{status:'MARKED'|'ALREADY_MARKED', record:object}>}
 */
async function markAttendance({ student, verification, deviceId, now = new Date() }) {
  const studentId = String(student.id || student._id);
  const cached = fromCooldown(studentId, now.getTime());
  if (cached) return { status: 'ALREADY_MARKED', record: cached };

  const dayKey = dayKeyOf(now);
  try {
    const doc = await Attendance.create({
      studentId,
      studentName: student.name,
      rollNo: student.rollNo,
      dayKey,
      checkInAt: now,
      status: isLate(now) ? 'Late' : 'Present',
      source: 'kiosk',
      verification,
      deviceId,
    });
    const record = doc.toJSON();
    recent.set(studentId, { at: now.getTime(), record });
    return { status: 'MARKED', record };
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const existing = await Attendance.findOne({ studentId, dayKey }).lean();
    recent.set(studentId, { at: now.getTime(), record: existing });
    return { status: 'ALREADY_MARKED', record: existing };
  }
}

const clearCooldowns = () => recent.clear();

module.exports = { markAttendance, clearCooldowns };
