import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/ui';

export default function Home() {
  return (
    <div className="home">
      <header className="home-header">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="scan" size={18} />
          </span>
          FaceAttend
        </div>
      </header>
      <main className="home-main">
        <h1>Face recognition attendance</h1>
        <p className="home-lead">
          Contactless check-in with identity verification and liveness protection.
        </p>
        <div className="home-cards">
          <Link to="/kiosk" className="home-card">
            <span className="home-card-icon">
              <Icon name="scan" size={28} />
            </span>
            <strong>Attendance kiosk</strong>
            <span>Start scanning faces on this device.</span>
          </Link>
          <Link to="/admin" className="home-card">
            <span className="home-card-icon">
              <Icon name="grid" size={28} />
            </span>
            <strong>Admin console</strong>
            <span>Register users, review attendance and manage devices.</span>
          </Link>
        </div>
      </main>
    </div>
  );
}
