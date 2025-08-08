import React, { useEffect, useState } from 'react';
import './AttendanceRecords.css';

const AttendanceRecords = () => {
  const [downloadUrl, setDownloadUrl] = useState('');

  useEffect(() => {
    // Set the URL for downloading attendance Excel
    setDownloadUrl('http://localhost:5000/api/download-attendance');
  }, []);

  return (<div className='box'>
    <div className="attendance-records-container">
      <h1 className="attendance-title">📊 Attendance Records</h1>
      <p className="attendance-description">
        Click the button below to download the latest attendance Excel report.
      </p>

      <a
        href={downloadUrl}
        download
        className="download-button"
      >
        📥 Download Excel Sheet
      </a>
    </div>
 </div> );
};

export default AttendanceRecords;
