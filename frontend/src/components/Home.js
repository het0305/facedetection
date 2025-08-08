// src/pages/Home.js

import React from 'react';
import './Home.css';

const Home = () => {
  const backgroundStyle = {
    backgroundImage: 'url(/images/10450447.webp)',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    height: '100vh',
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center'
  };
  
  return (
    <div className="home-container" style={backgroundStyle}>
      <div className="home-overlay">
        <h1>Welcome to the Attendance Portal</h1>
        <p>Register, Mark Attendance, and Track Records with Ease!</p>
        <a href="/register" className="home-btn">Get Started</a>
      </div>
    </div>
  );
};

export default Home;
