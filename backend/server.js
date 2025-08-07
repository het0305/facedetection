const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path'); // ✅ declared once
const dotenv = require('dotenv'); // ✅ added
const connectDB = require('./config/db'); 
dotenv.config(); // ✅ now works
connectDB();

const app = express();
app.use(cors());
app.use(express.json());

// 👇 Add this after other app.use(...) or routes
app.get('/api/download-attendance', (req, res) => {
  const filePath = path.join(__dirname, 'records', 'AttendanceRecords.xlsx');
  res.download(filePath);
});

// ✅ Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/students', require('./routes/studentRoutes'));
app.use('/api/attendance', require('./routes/attendanceRoutes'));

const PORT = process.env.PORT || 5000;

// ✅ Final working version
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

