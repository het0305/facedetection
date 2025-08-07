import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import CameraCapture from './CameraCapture';
import './RegisterStudent.css';
import './Attendance.css'; 

const RegisterStudent = () => {
  const [name, setName] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const navigate = useNavigate();

  const handleCapture = (imageSrc) => {
    const byteString = atob(imageSrc.split(',')[1]);
    const mimeString = imageSrc.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeString });
    const file = new File([blob], 'face.jpg', { type: mimeString });
    setImage(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!image) return setMessage({ type: 'error', text: '⚠ Please capture an image first!' });

    const formData = new FormData();
    formData.append('name', name);
    formData.append('rollNo', rollNo);
    formData.append('image', image);

    try {
      setLoading(true);
      const res = await axios.post('http://localhost:5000/api/students/register', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setMessage({ type: 'success', text: res.data.message || '✅ Student registered successfully' });

      setTimeout(() => {
        navigate('/attendance');
      }, 2000);

      setName('');
      setRollNo('');
      setImage(null);
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || '❌ Error registering student' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <h1 className="page-title">Register Student</h1>
      
      <div className="form-card glass-effect">
        <form onSubmit={handleSubmit} className="form-container">
          <input
            type="text"
            placeholder="Enter Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field"
            required
          />
          <input
            type="text"
            placeholder="Enter Roll Number"
            value={rollNo}
            onChange={(e) => setRollNo(e.target.value)}
            className="input-field"
            required
          />

          <CameraCapture onCapture={handleCapture} />

          <button type="submit" className={`submit-btn ${loading ? 'disabled' : ''}`} disabled={loading}>
            {loading ? '⏳ Registering...' : 'Register'}
          </button>
        </form>

        {message.text && (
          <p className={`status-text ${message.type}`}>{message.text}</p>
        )}
      </div>
    </div>
  );
};

export default RegisterStudent;
