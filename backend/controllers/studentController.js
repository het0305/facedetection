const Student = require('../models/Student');  // Ensure capital 'S' if file is Student.js
const { getFaceDescriptor } = require('../utils/faceUtils');

exports.registerStudent = async (req, res) => {
  try {
    const { name, rollNo } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    // Compute face descriptor INSIDE async function
    const descriptor = await getFaceDescriptor(req.file.buffer);

    const student = new Student({
      name,
      rollNo,
      embeddings: Array.from(descriptor) // Store as plain array
    });

    await student.save();

    res.json({ message: 'Student registered successfully', student });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
