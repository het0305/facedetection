const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path'); // ✅ Correct way to import Node's path
const connectDB = require('./config/db');
const { loadModels } = require('./utils/faceUtils');

dotenv.config();
connectDB();

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/students', require('./routes/studentRoutes'));
app.use('/api/attendance', require('./routes/attendanceRoutes'));

const PORT = process.env.PORT || 5000;

loadModels().then(() => {
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
});
