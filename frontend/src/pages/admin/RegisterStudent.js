import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import FaceCapture from '../../components/FaceCapture';
import { Icon, Modal, Notice } from '../../components/ui';
import { validateName, validateRollNo } from '../../utils/format';

export function buildSampleForm(samples, extra = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  form.append('poses', samples.map((s) => s.pose).join(','));
  samples.forEach((s, i) => form.append('images', s.blob, `sample-${i + 1}.jpg`));
  return form;
}

export function DuplicateWarning({ matches, busy, onCancel, onConfirm }) {
  return (
    <Modal
      title="A similar face is already registered"
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Saving...' : 'They are different people — continue'}
          </button>
        </>
      }
    >
      <p>Please verify before continuing. This face closely matches:</p>
      <ul className="dup-list">
        {matches.map((m) => (
          <li key={m.id}>
            <Link to={`/admin/students/${m.id}`} target="_blank" rel="noreferrer">
              {m.name}
            </Link>{' '}
            <span className="mono muted">{m.rollNo}</span> {!m.active && <span className="muted">(inactive)</span>}
          </li>
        ))}
      </ul>
      <p className="muted">
        Registering the same person twice makes recognition ambiguous. Only continue if you have confirmed these are
        different people. This decision is recorded in the audit log.
      </p>
    </Modal>
  );
}

export default function RegisterStudent() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [touched, setTouched] = useState(false);
  const [samples, setSamples] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const [created, setCreated] = useState(null);

  // This page owns the captured preview URLs once FaceCapture hands them over.
  useEffect(() => () => samples.forEach((s) => URL.revokeObjectURL(s.url)), [samples]);

  const nameError = validateName(name);
  const rollError = validateRollNo(rollNo);

  const submit = async (allowDuplicate = false) => {
    setBusy(true);
    setError(null);
    try {
      const form = buildSampleForm(samples, {
        name: name.trim(),
        rollNo: rollNo.trim(),
        ...(allowDuplicate ? { allowDuplicate: 'true' } : {}),
      });
      const res = await api.upload('/students', form);
      setDuplicate(null);
      setCreated(res.student);
      setStep(4);
    } catch (err) {
      if (err.code === 'DUPLICATE_FACE') setDuplicate(err.details?.matches || []);
      else {
        setDuplicate(null);
        setError(err.message);
        if (err.code === 'ROLLNO_EXISTS') setStep(1);
        if (['SAMPLE_REJECTED', 'INCONSISTENT_SAMPLES'].includes(err.code)) setStep(2);
      }
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep(1);
    setName('');
    setRollNo('');
    setSamples([]);
    setCreated(null);
    setTouched(false);
    setError(null);
  };

  return (
    <div className="page page-narrow">
      <div className="page-header">
        <div>
          <h1>Register user</h1>
          <p className="muted">Capture several face photos so the person is recognized reliably.</p>
        </div>
      </div>

      <ol className="stepper">
        {['Details', 'Face capture', 'Review', 'Done'].map((label, i) => (
          <li key={label} className={step === i + 1 ? 'current' : step > i + 1 ? 'done' : ''}>
            <span className="stepper-dot">{step > i + 1 ? <Icon name="check" size={14} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {error && (
        <Notice kind="danger" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}

      {step === 1 && (
        <form
          className="card card-pad form"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!nameError && !rollError) setStep(2);
          }}
          noValidate
        >
          <label className="field">
            <span>Full name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
            {touched && nameError && <small className="field-error">{nameError}</small>}
          </label>
          <label className="field">
            <span>Employee / roll number</span>
            <input value={rollNo} onChange={(e) => setRollNo(e.target.value)} maxLength={32} className="mono" />
            {touched && rollError && <small className="field-error">{rollError}</small>}
          </label>
          <Notice kind="info">
            Face photos are only used to create an encrypted face template. The photos themselves are not stored.
          </Notice>
          <div className="form-actions">
            <button className="btn btn-primary">
              Start face capture <Icon name="arrowRight" size={16} />
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <div className="card card-pad">
          <FaceCapture
            onCancel={() => setStep(1)}
            onComplete={(s) => {
              setSamples(s);
              setStep(3);
            }}
          />
        </div>
      )}

      {step === 3 && (
        <div className="card card-pad">
          <dl className="details">
            <div>
              <dt>Name</dt>
              <dd>{name.trim()}</dd>
            </div>
            <div>
              <dt>ID</dt>
              <dd className="mono">{rollNo.trim()}</dd>
            </div>
            <div>
              <dt>Face photos</dt>
              <dd>{samples.length}</dd>
            </div>
          </dl>
          <div className="review-thumbs">
            {samples.map((s, i) => (
              <img key={i} src={s.url} alt={`Sample ${i + 1}`} />
            ))}
          </div>
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={() => setStep(2)} disabled={busy}>
              Retake photos
            </button>
            <button className="btn btn-primary" onClick={() => submit(false)} disabled={busy}>
              {busy ? 'Verifying and saving...' : 'Save registration'}
            </button>
          </div>
        </div>
      )}

      {step === 4 && created && (
        <div className="card card-pad success-panel">
          <span className="success-icon">
            <Icon name="check" size={32} />
          </span>
          <h2>Face registered successfully.</h2>
          <p>
            {created.name} ({created.rollNo}) can now check in at the kiosk.
          </p>
          <div className="form-actions center">
            <button className="btn btn-ghost" onClick={reset}>
              Register another
            </button>
            <button className="btn btn-primary" onClick={() => navigate(`/admin/students/${created._id}`)}>
              View user
            </button>
          </div>
        </div>
      )}

      {duplicate && (
        <DuplicateWarning matches={duplicate} busy={busy} onCancel={() => setDuplicate(null)} onConfirm={() => submit(true)} />
      )}
    </div>
  );
}
