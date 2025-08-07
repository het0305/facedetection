import React, { useEffect, useState } from 'react';
import './AttendanceRecords.css';

const AttendanceRecords = () => {
  const [downloadUrl, setDownloadUrl] = useState('');

  useEffect(() => {
    // You can also add logic here to fetch some preview if needed
    setDownloadUrl('http://localhost:5000/api/download-attendance');
  }, []);

  return (
    <div className="attendance-records-container">
      <h2>📄 Attendance Records</h2>
      <p>You can download the attendance Excel sheet below:</p>
      <a
        href={downloadUrl}
        download
        className="download-button"
      >
        📥 Download Excel Sheet
      </a>
    </div>
  );
};

export default AttendanceRecords;
