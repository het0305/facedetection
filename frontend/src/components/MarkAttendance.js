import React, { useRef, useState, useEffect } from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';
import './MarkAttendance.css'; 
// specific styles for MarkAttendance
const MarkAttendance = () => {
  const webcamRef = useRef(null);
  const [status, setStatus] = useState('');
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch today's attendance
  const fetchAttendance = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/attendance/today');
      setAttendance(res.data || []);
    } catch (error) {
      console.error('Error fetching attendance:', error.message);
    }
  };

  // Capture image and mark attendance
  const captureAndMark = async () => {
    const imageSrc = webcamRef.current.getScreenshot();
    if (!imageSrc) return alert('No image captured!');

    setLoading(true);
    const blob = await (await fetch(imageSrc)).blob();
    const formData = new FormData();
    formData.append('image', blob, 'face.jpg');

    try {
      const res = await axios.post('http://localhost:5000/api/attendance/mark', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setStatus(res.data.message || 'Attendance marked successfully');
      setAttendance(res.data.todayAttendance || []);

      // Clear status message after 3 seconds
      setTimeout(() => setStatus(''), 3000);
    } catch (error) {
      setStatus(error.response?.data?.error || 'Error marking attendance');
      setTimeout(() => setStatus(''), 3000);
    } finally {
      setLoading(false);
    }
  };

  // Fetch attendance on mount and auto-refresh every 30 sec
  useEffect(() => {
    fetchAttendance();
    const interval = setInterval(fetchAttendance, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="page-container">
      <h2>📋 Mark Attendance</h2>

      <div className="camera-container">
        <Webcam
          audio={false}
          ref={webcamRef}
          screenshotFormat="image/jpeg"
          width={320}
          height={240}
          className="webcam-box"
        />
        <button onClick={captureAndMark} className="capture-btn" disabled={loading}>
          {loading ? '⏳ Processing...' : '📸 Capture & Mark'}
        </button>
      </div>

      {status && <p className="status-text">{status}</p>}

      <h3>Today's Attendance</h3>
      {attendance.length === 0 ? (
        <p>No attendance records yet</p>
      ) : (
        <ul className="attendance-list">
          {attendance.map(record => (
            <li key={record._id}>
              <strong>{record.studentId?.name}</strong> ({record.studentId?.rollNo}) – 
              {new Date(record.date).toLocaleTimeString()}
            </li>
          ))}
        </ul>
      )}
    </div>
  

);
};

export default MarkAttendance;
