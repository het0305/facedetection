import React, { useState } from 'react';
import axios from 'axios';
import CameraCapture from './CameraCapture';

const MarkAttendance = () => {
  const [status, setStatus] = useState('');

  const handleCapture = async (imageSrc) => {
    const blob = await (await fetch(imageSrc)).blob();
    const formData = new FormData();
    formData.append('image', blob, 'face.jpg');

    try {
      const res = await axios.post('http://localhost:5000/api/attendance/mark', formData);
      setStatus(res.data.message);
    } catch (error) {
      setStatus('Error marking attendance');
    }
  };

  return (
    <div style={{ textAlign: "center", marginTop: 20 }}>
      <h2>Mark Attendance</h2>
      <CameraCapture onCapture={handleCapture} />
      {status && <p>{status}</p>}
    </div>
  );
};

export default MarkAttendance;
