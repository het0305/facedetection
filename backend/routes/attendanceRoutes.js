const express = require('express');
const multer = require('multer');
const { markAttendance } = require('../controllers/attendanceController');

const upload = multer();
const router = express.Router();

router.post('/mark', upload.single('image'), markAttendance);

module.exports = router;
