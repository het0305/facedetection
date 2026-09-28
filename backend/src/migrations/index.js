// Idempotent startup migrations from the original schema:
//   students    { name, rollNo, embeddings:[128] }             -> encrypted samples[]
//   attendances { studentId, date, status }                     -> dayKey/checkInAt/snapshot
// Runs before indexes are built so the new unique (studentId, dayKey) index
// cannot fail half-way. Safe to run on every start.
const mongoose = require('mongoose');
const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const Admin = require('../models/Admin');
const Device = require('../models/Device');
const AuditLog = require('../models/AuditLog');
const { encryptDescriptor } = require('../utils/biometricCrypto');
const { dayKeyOf } = require('../utils/time');
const logger = require('../utils/logger');

async function migrateStudents(db) {
  const col = db.collection('students');
  let migrated = 0;
  const cursor = col.find({ embeddings: { $exists: true } });
  for await (const s of cursor) {
    const update = { $unset: { embeddings: '' } };
    const hasSamples = Array.isArray(s.samples) && s.samples.length > 0;
    if (!hasSamples && Array.isArray(s.embeddings) && s.embeddings.length === 128) {
      update.$set = {
        samples: [{ enc: encryptDescriptor(s.embeddings), pose: 'legacy', legacy: true, createdAt: s._id.getTimestamp() }],
        sampleCount: 1,
        hasLegacySample: true,
      };
    }
    await col.updateOne({ _id: s._id }, update);
    migrated += 1;
  }
  await col.updateMany({ active: { $exists: false } }, { $set: { active: true } });
  await col.updateMany({ sampleCount: { $exists: false } }, [
    { $set: { sampleCount: { $size: { $ifNull: ['$samples', []] } } } },
  ]);
  // Original records had no timestamps; derive createdAt from the ObjectId.
  await col.updateMany({ createdAt: { $exists: false } }, [
    { $set: { createdAt: { $toDate: '$_id' }, updatedAt: '$$NOW' } },
  ]);
  if (migrated) logger.info('Migrated legacy student embeddings', { count: migrated });
}

async function migrateAttendance(db) {
  const col = db.collection('attendances');
  const students = new Map();
  let migrated = 0;
  for await (const a of col.find({ dayKey: { $exists: false } })) {
    const key = String(a.studentId);
    if (!students.has(key)) {
      students.set(key, await db.collection('students').findOne({ _id: a.studentId }, { projection: { name: 1, rollNo: 1 } }));
    }
    const s = students.get(key);
    const at = a.date instanceof Date ? a.date : a._id.getTimestamp();
    await col.updateOne(
      { _id: a._id },
      {
        $set: {
          dayKey: dayKeyOf(at),
          checkInAt: at,
          studentName: s?.name || 'Deleted user',
          rollNo: s?.rollNo || '-',
          status: a.status === 'Late' ? 'Late' : 'Present',
          source: 'legacy',
          createdAt: a.createdAt || at,
          updatedAt: new Date(),
        },
        $unset: { date: '', image: '' },
      }
    );
    migrated += 1;
  }
  if (migrated) logger.info('Migrated legacy attendance records', { count: migrated });

  const dups = await col
    .aggregate([
      { $group: { _id: { s: '$studentId', d: '$dayKey' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $limit: 5 },
    ])
    .toArray();
  if (dups.length) {
    throw new Error(
      `Found duplicate attendance records for the same person and day (e.g. ${JSON.stringify(dups[0]._id)}). ` +
        'Remove the duplicates, then restart so the unique index can be created.'
    );
  }
}

async function runMigrations() {
  const db = mongoose.connection.db;
  await migrateStudents(db);
  await migrateAttendance(db);
  for (const model of [Student, Attendance, Admin, Device, AuditLog]) await model.createIndexes();
}

module.exports = { runMigrations };
