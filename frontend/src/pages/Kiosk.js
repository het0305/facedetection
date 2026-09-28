import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useCamera } from '../hooks/useCamera';
import { Icon, Notice, Spinner } from '../components/ui';
import '../styles/kiosk.css';

// How long a final result stays on screen before scanning resumes.
const RESULT_MS = { MARKED: 4000, ALREADY_MARKED: 3500 };
const DEFAULT_RESULT_MS = 3000;

const TONE = {
  NO_FACE: 'idle',
  QUALITY: 'warning',
  MULTIPLE_FACES: 'warning',
  VERIFYING: 'working',
  CHECKING_LIVENESS: 'working',
  CHALLENGE: 'challenge',
  MARKED: 'success',
  ALREADY_MARKED: 'info',
  UNKNOWN: 'danger',
  UNVERIFIED: 'danger',
  SPOOF: 'danger',
  LIVENESS_FAILED: 'danger',
  TIMEOUT: 'danger',
  ERROR: 'danger',
};

const STATE_ICON = {
  idle: 'scan',
  warning: 'alert',
  working: 'shield',
  challenge: 'user',
  success: 'check',
  info: 'check',
  danger: 'x',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function ChallengeCue({ type }) {
  if (type === 'blink') return <Icon name="eye" size={44} />;
  // Preview is mirrored, so "your left" is towards the left of the screen.
  return <Icon name={type === 'turn_left' ? 'arrowLeft' : 'arrowRight'} size={44} />;
}

export default function Kiosk() {
  const { loading, admin, kiosk, refresh } = useAuth();
  const authorized = !!(admin || kiosk);
  if (loading) return <Spinner full label="Loading..." />;
  if (!authorized) return <NotActivated />;
  if (!kiosk && admin) return <ActivateOrTest onActivated={refresh} />;
  return <Scanner deviceName={kiosk?.name} />;
}

function NotActivated() {
  return (
    <div className="kiosk kiosk-center">
      <div className="kiosk-card">
        <Icon name="lock" size={32} />
        <h1>This device is not activated</h1>
        <p>An administrator must sign in on this device and activate it as an attendance kiosk.</p>
        <Link className="btn btn-primary" to="/login" state={{ from: '/kiosk' }}>
          Administrator sign in
        </Link>
      </div>
    </div>
  );
}

function ActivateOrTest({ onActivated }) {
  const [name, setName] = useState('Main entrance');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [testMode, setTestMode] = useState(false);
  if (testMode) return <Scanner deviceName="Admin test mode" />;
  const activate = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/kiosk/activate', { name: name.trim() });
      await onActivated();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="kiosk kiosk-center">
      <form className="kiosk-card" onSubmit={activate}>
        <Icon name="monitor" size={32} />
        <h1>Activate attendance kiosk</h1>
        <p>This device will be allowed to record attendance until an administrator revokes it.</p>
        {error && <Notice kind="danger">{error}</Notice>}
        <label className="field">
          <span>Device name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        </label>
        <button className="btn btn-primary btn-block" disabled={busy || !name.trim()}>
          {busy ? 'Activating...' : 'Activate this device'}
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => setTestMode(true)}>
          Test without activating
        </button>
        <Link to="/admin" className="link">
          Back to admin console
        </Link>
      </form>
    </div>
  );
}

function Scanner({ deviceName }) {
  const { videoRef, status: camStatus, error: camError, start, capture } = useCamera();
  const now = useClock();
  const [view, setView] = useState({ state: 'NO_FACE', message: 'Looking for face...', face: null, progress: 0 });
  const [result, setResult] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [netError, setNetError] = useState(null);
  const gen = useRef(0); // bump to stop the current scan loop (StrictMode-safe)

  useEffect(() => {
    start();
  }, [start]);

  const loop = useCallback(async (g) => {
    let sessionId = '';
    let failures = 0;
    while (gen.current === g) {
      if (document.hidden) {
        await sleep(500);
        continue;
      }
      const blob = await capture(640);
      if (!blob) {
        await sleep(200);
        continue;
      }
      const form = new FormData();
      form.append('sessionId', sessionId);
      form.append('image', blob, 'frame.jpg');
      let out;
      try {
        out = await api.upload('/kiosk/scan', form);
        failures = 0;
        setNetError(null);
      } catch (err) {
        if (err.status === 401) {
          setFatal(err.message);
          return;
        }
        if (err.code === 'BUSY') {
          await sleep(150);
          continue;
        }
        failures += 1;
        sessionId = '';
        setNetError(err.status === 0 ? err.message : 'Something went wrong. Retrying...');
        await sleep(Math.min(8000, 1000 * failures));
        continue;
      }
      if (gen.current !== g) return;
      setView(out);
      if (out.terminal) {
        setResult(out);
        await sleep(RESULT_MS[out.state] || DEFAULT_RESULT_MS);
        setResult(null);
        setView({ state: 'NO_FACE', message: 'Looking for face...', face: null, progress: 0 });
        sessionId = '';
      } else {
        sessionId = out.sessionId;
        // Idle frames are sent less often to save CPU.
        await sleep(out.state === 'NO_FACE' ? 350 : out.state === 'CHALLENGE' ? 0 : 80);
      }
    }
  }, [capture]);

  useEffect(() => {
    if (camStatus !== 'ready' || fatal) return undefined;
    loop(++gen.current);
    return () => {
      gen.current += 1;
    };
  }, [camStatus, loop, fatal]);

  const shown = result || view;
  const tone = TONE[shown.state] || 'idle';
  const box = shown.face;

  return (
    <div className="kiosk">
      <header className="kiosk-header">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="scan" size={18} />
          </span>
          FaceAttend
        </div>
        <div className="kiosk-device">{deviceName}</div>
        <Link to="/" className="kiosk-exit" aria-label="Exit kiosk">
          <Icon name="x" size={18} />
        </Link>
      </header>

      <main className="kiosk-main">
        <section className={`kiosk-stage tone-${tone}`} aria-label="Camera preview">
          <video ref={videoRef} className="kiosk-video" playsInline muted autoPlay />
          <div className="face-guide" aria-hidden="true" />
          {box && !result && (
            <div
              className={`face-box tone-${tone}`}
              style={{
                left: `${(1 - box.x - box.width) * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              }}
            />
          )}
          {camStatus === 'starting' && <Spinner full label="Starting camera..." />}
          {camStatus === 'error' && (
            <div className="kiosk-overlay">
              <Icon name="camera" size={36} />
              <p>{camError}</p>
              <button className="btn btn-primary" onClick={start}>
                Try again
              </button>
            </div>
          )}
          {fatal && (
            <div className="kiosk-overlay">
              <Icon name="lock" size={36} />
              <p>{fatal}</p>
              <Link className="btn btn-primary" to="/login" state={{ from: '/kiosk' }}>
                Administrator sign in
              </Link>
            </div>
          )}
          {shown.state === 'CHALLENGE' && !result && (
            <div className="challenge-cue">
              <ChallengeCue type={shown.challenge} />
            </div>
          )}
        </section>

        <aside className="kiosk-panel">
          <div className="kiosk-clock">
            <div className="kiosk-time">
              {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div className="kiosk-date">
              {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>

          <div className={`status-card tone-${tone}`} aria-live="polite">
            <div className="status-icon">
              <Icon name={STATE_ICON[tone]} size={28} />
            </div>
            <div className="status-text">
              <div className="status-message">{shown.message}</div>
              {!result && tone === 'working' && (
                <div className="progress" aria-hidden="true">
                  <span style={{ width: `${Math.round((shown.progress || 0) * 100)}%` }} />
                </div>
              )}
            </div>
          </div>

          {result && result.result && (
            <div className={`result-card tone-${tone}`}>
              <div className="result-name">{result.result.name}</div>
              <dl>
                <div>
                  <dt>ID</dt>
                  <dd>{result.result.rollNo}</dd>
                </div>
                <div>
                  <dt>{result.state === 'ALREADY_MARKED' ? 'Checked in at' : 'Time'}</dt>
                  <dd>{new Date(result.result.checkInAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{result.result.attendanceStatus}</dd>
                </div>
              </dl>
            </div>
          )}

          {netError && <Notice kind="warning">{netError}</Notice>}

          <ol className="kiosk-steps">
            <li>Stand in front of the camera, one person at a time.</li>
            <li>Keep your face inside the frame and look at the camera.</li>
            <li>Follow the on-screen instruction when asked.</li>
          </ol>
        </aside>
      </main>
    </div>
  );
}
