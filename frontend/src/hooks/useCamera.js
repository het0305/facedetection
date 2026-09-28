import { useCallback, useEffect, useRef, useState } from 'react';

// Friendly messages for getUserMedia failures.
function cameraErrorMessage(err) {
  if (!window.isSecureContext) return 'Camera access requires a secure connection (HTTPS).';
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Unable to access the camera. Please check camera permissions.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found. Please connect a camera and try again.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is being used by another application. Close it and try again.';
    default:
      return 'Unable to access the camera. Please check camera permissions.';
  }
}

/**
 * Camera preview + frame capture. The preview is mirrored with CSS only;
 * captured frames are NOT mirrored so enrollment and recognition see the
 * same (true) orientation.
 */
export function useCamera({ idealWidth = 1280, idealHeight = 720 } = {}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | starting | ready | error
  const [error, setError] = useState(null);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('error');
      setError(cameraErrorMessage(null));
      return;
    }
    setStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: idealWidth }, height: { ideal: idealHeight } },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError(cameraErrorMessage(err));
    }
  }, [idealWidth, idealHeight]);

  useEffect(() => stop, [stop]);

  /** Capture the current frame as a JPEG Blob, downscaled to maxWidth. */
  const capture = useCallback((maxWidth = 640, quality = 0.88) => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return Promise.resolve(null);
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
    const canvas = canvasRef.current;
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
  }, []);

  return { videoRef, status, error, start, stop, capture };
}
