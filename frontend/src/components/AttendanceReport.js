import React, { useEffect, useState } from 'react';
import axios from 'axios';

const AttendanceReport = () => {
  const [attendance, setAttendance] = useState([]);

  useEffect(() => {
    const fetchAttendance = async () => {
      const today = new Date().toISOString().slice(0,10); // YYYY-MM-DD
      const res = await axios.get(`http://localhost:5000/api/attendance/report?date=${today}`);
      setAttendance(res.data);
    };
    fetchAttendance();
  }, []);

  return (
    <div style={{ textAlign: "center", marginTop: 20 }}>
      <h2>Today's Attendance</h2>
      <ul>
        {attendance.length === 0 ? (
          <p>No attendance records yet</p>
        ) : (
          attendance.map((a, i) => (
            <li key={i}>{a.studentName} - {a.status}</li>
          ))
        )}
      </ul>
    </div>
  );
};

export default AttendanceReport;
