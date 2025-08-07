const Student = require('../models/Student');
const { getFaceDescriptor } = require('../utils/faceUtils');
const path = require('path');
const fs = require('fs');

/**
 * Register a new student with face image and roll number
 */
exports.registerStudent = async (req, res) => {
  try {
    const { name, rollNo } = req.body;

    // 🔹 Ensure image was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded. Please capture a photo.' });
    }

    const imagePath = req.file.path;

    // 🔹 Get facial descriptor from image
    const descriptor = await getFaceDescriptor(imagePath);

    if (!descriptor) {
      fs.unlinkSync(imagePath); // Delete unusable image
      return res.status(400).json({ error: 'No face detected. Try again with better lighting or face angle.' });
    }

    // 🔹 Prevent duplicate registration with same roll number
    const existingStudent = await Student.findOne({ rollNo });
    if (existingStudent) {
      fs.unlinkSync(imagePath);
      return res.status(400).json({ error: 'Roll number already exists.' });
    }

    // 🔹 Save student to database
    const student = new Student({
      name,
      rollNo,
      embeddings: Array.from(descriptor), // Float32Array → plain JS array
      image: `/uploads/${req.file.filename}`,
    });

    await student.save();

    console.log('✅ Student registered:', student.name);

    return res.status(201).json({ 
      message: 'Student registered successfully.', 
      student 
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    return res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
