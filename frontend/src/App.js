import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import RegisterStudent from './components/RegisterStudent';
import MarkAttendance from './components/MarkAttendance';
import AttendanceReport from './components/AttendanceReport';

function App() {
  return (
    <Router>
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <Link to="/register" style={{ marginRight: 20 }}>Register Student</Link>
        <Link to="/attendance" style={{ marginRight: 20 }}>Mark Attendance</Link>
        <Link to="/attendance-report">Attendance Records</Link>
      </div>
      <Routes>
        <Route path="/register" element={<RegisterStudent />} />
        <Route path="/attendance" element={<MarkAttendance />} />
        <Route path="/attendance-report" element={<AttendanceReport />} />
      </Routes>
    </Router>
  );
}

export default App;
