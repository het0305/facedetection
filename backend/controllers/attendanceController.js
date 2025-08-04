const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const { getFaceDescriptor } = require('../utils/faceUtils');

exports.markAttendance = async (req, res) => {
  try {
    const imageBuffer = req.file.buffer;
    const descriptor = await getFaceDescriptor(imageBuffer);

    // Compare with stored students
    const students = await Student.find();
    let bestMatch = null;
    let minDistance = 0.6; // threshold

    students.forEach(student => {
      const distance = faceapi.euclideanDistance(descriptor, student.embeddings);
      if (distance < minDistance) {
        minDistance = distance;
        bestMatch = student;
      }
    });

    if (!bestMatch) return res.json({ message: 'No match found' });

    // Check if already marked
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await Attendance.findOne({
      studentId: bestMatch._id,
      date: { $gte: today }
    });

    if (existing) {
      return res.json({ message: `${bestMatch.name} already marked` });
    }

    await Attendance.create({ studentId: bestMatch._id });
    res.json({ message: `${bestMatch.name} marked present` });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
