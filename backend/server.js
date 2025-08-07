const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const { loadModels } = require('./utils/faceUtils'); // ✅ Import face-api.js model loader

// Load environment variables from .env
dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json()); // To parse JSON body

// Static folder to serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve attendance Excel download
app.get('/api/download-attendance', (req, res) => {
  const filePath = path.join(__dirname, 'records', 'AttendanceRecords.xlsx');
  res.download(filePath, err => {
    if (err) {
      console.error('❌ Error sending attendance file:', err.message);
      res.status(500).send('Failed to download attendance file');
    }
  });
});

// API Routes
app.use('/api/students', require('./routes/studentRoutes'));
app.use('/api/attendance', require('./routes/attendanceRoutes'));

// Load face-api.js models
loadModels().catch(err => {
  console.error("❌ Could not load face-api models. Exiting...");
  process.exit(1); // Exit if models aren't loaded
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
