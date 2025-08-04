const express = require('express');
const multer = require('multer');
const { registerStudent } = require('../controllers/studentController');

const upload = multer();
const router = express.Router();

router.post('/register', upload.single('image'), registerStudent);

module.exports = router;
