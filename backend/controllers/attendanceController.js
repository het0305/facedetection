const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const { getFaceDescriptor } = require('../utils/faceUtils');
const faceapi = require('face-api.js');

/**
 * Mark attendance (only once per day)
 */
exports.markAttendance = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    // ✅ Await inside async function
    const descriptor = await getFaceDescriptor(req.file.path);

    if (!descriptor) return res.status(400).json({ error: 'No face detected' });

    // Compare with all students
    const students = await Student.find();
    let recognizedStudent = null;
    let minDistance = 0.5;

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

    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(); endOfDay.setHours(23,59,59,999);

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

    // Save new attendance
    const attendance = new Attendance({
      studentId: recognizedStudent._id,
      status: 'Present',
      image: `/uploads/${req.file.filename}`, // optional image
    });
    await attendance.save();

    const todayAttendance = await getUniqueTodayAttendance(startOfDay, endOfDay);

    res.json({ 
      message: `Attendance marked for ${recognizedStudent.name}`, 
      todayAttendance 
    });
  } catch (error) {
    console.error('Attendance Error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Fetch today's unique attendance
 */
exports.getTodayAttendance = async (req, res) => {
  try {
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(); endOfDay.setHours(23,59,59,999);

    const todayAttendance = await getUniqueTodayAttendance(startOfDay, endOfDay);
    res.json(todayAttendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Utility: Get unique attendance list for today
 */
async function getUniqueTodayAttendance(startOfDay, endOfDay) {
  const records = await Attendance.find({
    date: { $gte: startOfDay, $lte: endOfDay },
  }).populate('studentId', 'name rollNo');

  const uniqueAttendance = [];
  const seen = new Set();

  records.forEach(record => {
    const id = record.studentId._id.toString();
    if (!seen.has(id)) {
      seen.add(id);
      uniqueAttendance.push(record);
    }
  });

  return uniqueAttendance;
}
