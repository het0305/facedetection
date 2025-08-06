import React, { useRef } from 'react';
import Webcam from 'react-webcam';
import './Attendance.css';

const CameraCapture = ({ onCapture }) => {
  const webcamRef = useRef(null);

  const capture = () => {
    const imageSrc = webcamRef.current.getScreenshot();
    onCapture(imageSrc);
  };

  return (
    <div className="camera-container">
      <Webcam
        audio={false}
        ref={webcamRef}
        screenshotFormat="image/jpeg"
        width={320}
        height={240}
      />
      <button className="capture-btn" onClick={capture}>📸 Capture Photo</button>
    </div>
  );
};

export default CameraCapture;
