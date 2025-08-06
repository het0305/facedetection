const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { markAttendance, getTodayAttendance } = require('../controllers/attendanceController');

// ✅ Storage with unique filenames
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads')); // Save to uploads folder
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

router.post('/mark', upload.single('image'), markAttendance);
router.get('/today', getTodayAttendance);

module.exports = router;
