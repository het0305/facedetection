import React, { useRef } from 'react';
import Webcam from 'react-webcam';

const CameraCapture = ({ onCapture }) => {
  const webcamRef = useRef(null);

  const capture = () => {
    const imageSrc = webcamRef.current.getScreenshot();
    if (!imageSrc) {
      alert('No image captured! Allow camera access.');
      return;
    }
    console.log("Captured Image:", imageSrc.slice(0, 50)); // Debug
    onCapture(imageSrc);
  };

  const videoConstraints = {
    width: 640,
    height: 480,
    facingMode: "user"
  };

  return (
    <div style={{ textAlign: "center" }}>
      <Webcam
        audio={false}
        ref={webcamRef}
        screenshotFormat="image/jpeg"
        width={640}
        height={480}
        videoConstraints={videoConstraints}
      />
      <div style={{ marginTop: "10px" }}>
        <button type="button" onClick={capture}>📸 Capture Photo</button>
      </div>
    </div>
  );
};

export default CameraCapture;
