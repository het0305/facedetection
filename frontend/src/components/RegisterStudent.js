import React, { useState } from 'react';
import axios from 'axios';
import CameraCapture from './CameraCapture';

const RegisterStudent = () => {
  const [name, setName] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [image, setImage] = useState(null);

  const handleCapture = (imageSrc) => {
    // Convert base64 to Blob
    fetch(imageSrc)
      .then(res => res.blob())
      .then(blob => setImage(blob));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!image) return alert('Please capture an image first');

    const formData = new FormData();
    formData.append('name', name);
    formData.append('rollNo', rollNo);
    formData.append('image', image, 'face.jpg');

    try {
      await axios.post('http://localhost:5000/api/students/register', formData);
      alert('Student registered successfully');
    } catch (error) {
      alert(error.response?.data?.error || 'Error registering student');
    }
  };

  return (
    <div style={{ textAlign: "center", marginTop: 20 }}>
      <h2>Register Student</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <br />
        <input
          type="text"
          placeholder="Roll Number"
          value={rollNo}
          onChange={(e) => setRollNo(e.target.value)}
          required
        />
        <br /><br />
        <CameraCapture onCapture={handleCapture} />
        <br />
        <button type="submit">Register</button>
      </form>
    </div>
  );
};

export default RegisterStudent;
