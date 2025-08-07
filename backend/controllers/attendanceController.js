const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const { getFaceDescriptor } = require('../utils/faceUtils');
const faceapi = require('face-api.js');
const { updateExcel } = require('../utils/excelUtils'); // ✅ Excel function

/**
 * ✅ Mark attendance using face recognition (once per day per student)
 */
exports.markAttendance = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    // ➕ Get facial descriptor from image
    const descriptor = await getFaceDescriptor(req.file.path);
    if (!descriptor) {
      return res.status(400).json({ error: 'No face detected in the image' });
    }

    const students = await Student.find();
    let recognizedStudent = null;
    let minDistance = 0.5;

    // ➕ Compare with saved embeddings
    students.forEach(student => {
      const distance = faceapi.euclideanDistance(descriptor, student.embeddings);
      if (distance < minDistance) {
        minDistance = distance;
        recognizedStudent = student;
      }
    });

    if (!recognizedStudent) {
      return res.status(404).json({ error: 'Student not recognized' });
    }

    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);

    const existingAttendance = await Attendance.findOne({
      studentId: recognizedStudent._id,
      date: { $gte: startOfDay, $lte: endOfDay },
    });

    if (existingAttendance) {
      const todayAttendance = await getUniqueTodayAttendance(startOfDay, endOfDay);
      return res.json({
        message: `Attendance already marked for ${recognizedStudent.name}`,
        todayAttendance
      });
    }

    // ➕ Save new attendance
    const attendance = new Attendance({
      studentId: recognizedStudent._id,
      status: 'Present',
      image: `/uploads/${req.file.filename}`,
      date: new Date()
    });

    await attendance.save();

    // ✅ Get today’s attendance and update Excel file
    const todayAttendance = await getUniqueTodayAttendance(startOfDay, endOfDay);
    await updateExcel(todayAttendance); // 🔁 Update sheet with today's records

    res.json({
      message: `Attendance marked for ${recognizedStudent.name}`,
      todayAttendance
    });

  } catch (error) {
    console.error('Attendance Error:', error.message);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

/**
 * ✅ Get all today's attendance records
 */
exports.getTodayAttendance = async (req, res) => {
  try {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);

    const todayAttendance = await getUniqueTodayAttendance(startOfDay, endOfDay);
    res.json(todayAttendance);
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

/**
 * 🔁 Utility: get unique records for the day
 */
async function getUniqueTodayAttendance(startOfDay, endOfDay) {
  const records = await Attendance.find({
    date: { $gte: startOfDay, $lte: endOfDay }
  }).populate('studentId', 'name rollNo');

  const uniqueAttendance = [];
  const seen = new Set();

  for (const record of records) {
    const id = record.studentId._id.toString();
    if (!seen.has(id)) {
      seen.add(id);
      uniqueAttendance.push(record);
    }
  }

  return uniqueAttendance;
}
