import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useCamera } from '../hooks/useCamera';
import { Icon, Notice, Spinner } from './ui';

// Guided enrollment. Each step asks for a pose; frames are checked by the
// server (quality, single face, pose, liveness) and a sample is captured
// automatically after two consecutive good frames. Nothing is stored until
// the whole registration is submitted.
export const STEPS = [
  { pose: 'front', label: 'Look straight at the camera' },
  { pose: 'left', label: 'Turn your head slightly to your left' },
  { pose: 'right', label: 'Turn your head slightly to your right' },
  { pose: 'front', label: 'Look straight, relaxed expression' },
  { pose: 'front', label: 'Look straight once more' },
];

const GOOD_FRAMES_NEEDED = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function FaceCapture({ onComplete, onCancel }) {
  const { videoRef, status, error, start, capture } = useCamera();
  const [samples, setSamples] = useState([]); // { blob, url, pose }
  const [feedback, setFeedback] = useState({ ok: false, message: 'Preparing camera...' });
  const [box, setBox] = useState(null);
  const [flash, setFlash] = useState(false);
  const [fatal, setFatal] = useState(null);
  // Each loop gets a generation number; bumping it stops that loop. This stays
  // correct when React StrictMode runs effects twice.
  const gen = useRef(0);
  const active = useRef(false);
  const samplesRef = useRef([]);

  useEffect(() => {
    start();
  }, [start]);

  // Preview URLs are revoked on unmount unless ownership was handed to the
  // parent via onComplete (the parent then revokes them).
  const handedOff = useRef(false);
  useEffect(
    () => () => {
      if (!handedOff.current) samplesRef.current.forEach((s) => URL.revokeObjectURL(s.url));
    },
    []
  );

  const step = STEPS[samples.length];
  const done = samples.length >= STEPS.length;

  const loop = useCallback(async (g) => {
    active.current = true;
    let good = 0;
    while (gen.current === g && samplesRef.current.length < STEPS.length) {
      const current = STEPS[samplesRef.current.length];
      const blob = await capture(960, 0.92);
      if (!blob) {
        await sleep(200);
        continue;
      }
      const form = new FormData();
      form.append('pose', current.pose);
      form.append('image', blob, 'sample.jpg');
      let r;
      try {
        r = await api.upload('/students/check-sample', form);
      } catch (err) {
        if (err.status === 401) {
          setFatal('Your session has expired. Please sign in again.');
          return;
        }
        setFeedback({ ok: false, message: err.message });
        await sleep(1000);
        continue;
      }
      if (gen.current !== g) return;
      setBox(r.face || null);
      setFeedback({ ok: r.ok, message: r.ok ? 'Hold still...' : r.message });
      good = r.ok ? good + 1 : 0;
      if (good >= GOOD_FRAMES_NEEDED) {
        good = 0;
        const sample = { blob, url: URL.createObjectURL(blob), pose: current.pose };
        samplesRef.current = [...samplesRef.current, sample];
        setSamples(samplesRef.current);
        setFlash(true);
        setTimeout(() => setFlash(false), 250);
        setFeedback({ ok: true, message: 'Captured.' });
        await sleep(700);
      } else {
        await sleep(120);
      }
    }
    // Finished all steps: mark idle so "Retake" can start a new loop.
    if (gen.current === g) active.current = false;
  }, [capture]);

  useEffect(() => {
    if (status !== 'ready' || fatal) return undefined;
    loop(++gen.current);
    return () => {
      gen.current += 1;
      active.current = false;
    };
  }, [status, loop, fatal]);

  const retake = (index) => {
    const keep = samplesRef.current.slice(0, index);
    samplesRef.current.slice(index).forEach((s) => URL.revokeObjectURL(s.url));
    samplesRef.current = keep;
    setSamples(keep);
    if (!active.current && status === 'ready') loop(++gen.current);
  };

  return (
    <div className="capture">
      <div className="capture-stage">
        <div className={`capture-video-wrap ${flash ? 'flash' : ''}`}>
          <video ref={videoRef} className="capture-video" playsInline muted autoPlay />
          <div className="face-guide" aria-hidden="true" />
          {box && !done && (
            <div
              className={`face-box ${feedback.ok ? 'tone-success' : 'tone-warning'}`}
              style={{
                left: `${(1 - box.x - box.width) * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              }}
            />
          )}
          {status === 'starting' && <Spinner full label="Starting camera..." />}
          {status === 'error' && (
            <div className="capture-overlay">
              <Icon name="camera" size={32} />
              <p>{error}</p>
              <button type="button" className="btn btn-primary" onClick={start}>
                Try again
              </button>
            </div>
          )}
        </div>
        {!done && status === 'ready' && (
          <div className={`capture-instruction ${feedback.ok ? 'ok' : ''}`} aria-live="polite">
            <div className="capture-step-label">
              Step {samples.length + 1} of {STEPS.length}: {step.label}
            </div>
            <div className="capture-feedback">{feedback.message}</div>
          </div>
        )}
        {done && (
          <Notice kind="success" title="All photos captured">
            Review the photos below, then continue.
          </Notice>
        )}
        {fatal && <Notice kind="danger">{fatal}</Notice>}
      </div>

      <ol className="capture-thumbs">
        {STEPS.map((s, i) => (
          <li key={i} className={i === samples.length ? 'current' : i < samples.length ? 'done' : ''}>
            {samples[i] ? (
              <button type="button" className="thumb" onClick={() => retake(i)} title="Retake from this photo">
                <img src={samples[i].url} alt={`Sample ${i + 1}`} />
                <span className="thumb-retake">Retake</span>
              </button>
            ) : (
              <div className="thumb thumb-empty">{i + 1}</div>
            )}
            <span className="thumb-label">{s.label}</span>
          </li>
        ))}
      </ol>

      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Back
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={!done} onClick={() => {
            handedOff.current = true;
            onComplete(samples);
          }}>
          Continue
        </button>
      </div>
    </div>
  );
}
