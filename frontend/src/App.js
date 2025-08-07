import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import RegisterStudent from './components/RegisterStudent';
import MarkAttendance from './components/MarkAttendance';
import AttendanceRecords from './components/AttendanceRecords'; // adjust path if needed
import Home from './components/Home';
import './App.css';

function App() {
  return (
    <Router>
      <div className='container'>
        {/* NAVBAR */}
        <div className="navbar">
          <div className="nav-title">
            📋 Attendance Portal
          </div>
          <div className="nav-links">
            <Link to="/">Home</Link>
            <Link to="/register">Register Student</Link>
            <Link to="/attendance">Mark Attendance</Link>
            <Link to="/attendance-report">Attendance Records</Link>
          </div>
        </div>

        {/* ROUTES */}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/register" element={<RegisterStudent />} />
          <Route path="/attendance" element={<MarkAttendance />} />
          <Route path="/records" element={<AttendanceRecords />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
