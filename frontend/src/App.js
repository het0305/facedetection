import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import RegisterStudent from './components/RegisterStudent';
import MarkAttendance from './components/MarkAttendance';
import AttendanceRecords from './components/AttendanceRecords';
import Home from './components/Home';
import './App.css';

function App() {
  return (
    <Router>
      <div className='container'>
        {/* ==== NAVBAR ==== */}
        <div className="navbar">
          <div className="nav-title">
            Attendance Portal
          </div>
          <div className="nav-links">
            <Link to="/">Home</Link>
            <Link to="/register">Register Student</Link>
            <Link to="/attendance">Mark Attendance</Link>
            <Link to="/records">Attendance Records</Link> {/* ✅ Fixed path */}
          </div>
        </div>

        {/* ==== ROUTES ==== */}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/register" element={<RegisterStudent />} />
          <Route path="/attendance" element={<MarkAttendance />} />
          <Route path="/records" element={<AttendanceRecords />} /> {/* ✅ Matches Link */}
          <Route path="*" element={<h2 style={{ textAlign: 'center', marginTop: '50px' }}>404 - Page Not Found</h2>} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
