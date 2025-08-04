const Student = require('../models/Student');
const { getFaceDescriptor } = require('../utils/faceUtils');

exports.registerStudent = async (req, res) => {
  try {
    const { name, rollNo } = req.body;
    const imageBuffer = req.file.buffer;

    const descriptor = await getFaceDescriptor(imageBuffer);

    const student = new Student({
      name,
      rollNo,
      embeddings: Array.from(descriptor)
    });

    await student.save();
    res.json({ message: 'Student registered successfully', student });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
