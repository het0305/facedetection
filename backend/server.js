const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const { loadModels } = require('./utils/faceUtils');

// ✅ Load environment variables
dotenv.config();

// ✅ Connect to MongoDB
connectDB();

const app = express();

// ✅ Middleware
app.use(cors());
app.use(express.json());

// ✅ Serve uploaded images statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ✅ Serve attendance Excel file for download
app.get('/api/download-attendance', (req, res) => {
  const filePath = path.join(__dirname, 'records', 'AttendanceRecords.xlsx');
  res.download(filePath, (err) => {
    if (err) {
      console.error('❌ Error downloading attendance file:', err.message);
      res.status(500).send('Failed to download attendance file');
    }
  });
});

// ✅ API Routes
app.use('/api/students', require('./routes/studentRoutes'));
app.use('/api/attendance', require('./routes/attendanceRoutes'));

// ✅ Load face-api.js models before starting the server
loadModels()
  .then(() => {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error("❌ Could not load face-api.js models. Exiting...");
    process.exit(1);
  });
