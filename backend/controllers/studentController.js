const Student = require('../models/Student');
const { getFaceDescriptor } = require('../utils/faceUtils');
const path = require('path');
const fs = require('fs');

exports.registerStudent = async (req, res) => {
  try {
    const { name, rollNo } = req.body;

    // 1️⃣ Check if file exists
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded. Please capture a photo.' });
    }

    // 2️⃣ Get the saved file path from Multer
    const imagePath = req.file.path;

    // 3️⃣ Generate face descriptor
    const descriptor = await getFaceDescriptor(imagePath);
    if (!descriptor) {
      // Optional: Delete file if no face detected
      fs.unlinkSync(imagePath);
      return res.status(400).json({ error: 'No face detected in the image. Try again with clear lighting.' });
    }

    // 4️⃣ Optional: Check for duplicate roll number
    const existingStudent = await Student.findOne({ rollNo });
    if (existingStudent) {
      fs.unlinkSync(imagePath);
      return res.status(400).json({ error: 'Roll number already registered.' });
    }

    // 5️⃣ Save student
    const student = new Student({
      name,
      rollNo,
      embeddings: Array.from(descriptor),
      image: `/uploads/${req.file.filename}`, // Save image path for reference
    });

    await student.save();

    console.log('✅ Student registered:', student.name);

    res.json({ 
      message: 'Student registered successfully', 
      student 
    });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ error: 'Server error during registration: ' + error.message });
  }
};
