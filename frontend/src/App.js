import React from 'react';
import RegisterStudent from './components/RegisterStudent';
import MarkAttendance from './components/MarkAttendance';
import AttendanceReport from './components/AttendanceReport';

function App() {
  return (
    <div>
      <h1 style={{ textAlign: "center" }}>Face Attendance System</h1>
      <RegisterStudent />
      <MarkAttendance />
      <AttendanceReport />
    </div>
  );
}

export default App;
