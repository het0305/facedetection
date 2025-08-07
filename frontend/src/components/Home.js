// src/pages/Home.js

import React from 'react';
import './Home.css';

const Home = () => {
  return (
    <div className="home-container">
      <div className="home-overlay">
        <h1>Welcome to the Attendance Portal</h1>
        <p>Register, Mark Attendance, and Track Records with Ease!</p>
        <a href="/register" className="home-btn">Get Started</a>
      </div>
    </div>
  );
};

export default Home;
