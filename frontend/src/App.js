import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import RegisterStudent from './components/RegisterStudent';
import MarkAttendance from './components/MarkAttendance';

function App() {
  return (
    <Router>
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <Link to="/register" style={{ marginRight: 20 }}>Register Student</Link>
        <Link to="/attendance">Mark Attendance</Link>
      </div>
      <Routes>
        <Route path="/register" element={<RegisterStudent />} />
        <Route path="/attendance" element={<MarkAttendance />} />
      </Routes>
    </Router>
  );
}

export default App;
