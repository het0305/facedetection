import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import FaceCapture from '../../components/FaceCapture';
import { ConfirmDialog, EmptyState, Icon, Modal, Notice, Pill, Spinner } from '../../components/ui';
import { formatDateTime, formatDayKey, formatTime, validateName, validateRollNo } from '../../utils/format';
import { useSystem } from './AdminLayout';
import { buildSampleForm, DuplicateWarning } from './RegisterStudent';

export default function StudentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { timezone } = useSystem();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', rollNo: '' });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'delete' | 'deactivate'
  const [reenroll, setReenroll] = useState(false);
  const [pendingSamples, setPendingSamples] = useState(null);
  const [duplicate, setDuplicate] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get(`/students/${id}`));
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !data) return <Notice kind="danger">{error}</Notice>;
  if (!data) return <Spinner label="Loading..." />;
  const s = data.student;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/students/${id}`, { name: form.name.trim(), rollNo: form.rollNo.trim() });
      setEditing(false);
      setNotice('Details updated.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (active) => {
    setBusy(true);
    try {
      await api.patch(`/students/${id}`, { active });
      setNotice(active ? 'User activated.' : 'User deactivated. They can no longer check in.');
      setConfirm(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/students/${id}`);
      navigate('/admin/students', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
      setConfirm(null);
    }
  };

  const uploadFace = async (samples, allowDuplicate = false) => {
    setBusy(true);
    setError(null);
    try {
      const fd = buildSampleForm(samples, allowDuplicate ? { allowDuplicate: 'true' } : {});
      await api.uploadPut(`/students/${id}/face`, fd);
      setReenroll(false);
      setDuplicate(null);
      setPendingSamples(null);
      setNotice('Face updated successfully.');
      await load();
    } catch (err) {
      if (err.code === 'DUPLICATE_FACE') {
        setPendingSamples(samples);
        setDuplicate(err.details?.matches || []);
      } else {
        setDuplicate(null);
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const nameError = editing ? validateName(form.name) : null;
  const rollError = editing ? validateRollNo(form.rollNo) : null;

  return (
    <div className="page page-narrow">
      <Link to="/admin/students" className="link back-link">
        <Icon name="arrowLeft" size={16} /> Users
      </Link>
      <div className="page-header">
        <div>
          <h1>{s.name}</h1>
          <p className="muted mono">{s.rollNo}</p>
        </div>
        {s.active ? <Pill kind="success">Active</Pill> : <Pill>Inactive</Pill>}
      </div>

      {notice && (
        <Notice kind="success" onClose={() => setNotice(null)}>
          {notice}
        </Notice>
      )}
      {error && (
        <Notice kind="danger" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}
      {(s.hasLegacySample || s.sampleCount < 3) && (
        <Notice kind="warning" title="Re-registration recommended">
          This user has only {s.sampleCount} face sample{s.sampleCount === 1 ? '' : 's'}
          {s.hasLegacySample ? ' from the previous system' : ''}. Re-register their face for reliable recognition.
        </Notice>
      )}

      <section className="card">
        <div className="card-header">
          <h2>Details</h2>
          {!editing && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setForm({ name: s.name, rollNo: s.rollNo });
                setEditing(true);
              }}
            >
              <Icon name="edit" size={16} /> Edit
            </button>
          )}
        </div>
        {editing ? (
          <form className="form card-pad" onSubmit={save} noValidate>
            <label className="field">
              <span>Full name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} />
              {nameError && <small className="field-error">{nameError}</small>}
            </label>
            <label className="field">
              <span>Employee / roll number</span>
              <input className="mono" value={form.rollNo} onChange={(e) => setForm({ ...form, rollNo: e.target.value })} maxLength={32} />
              {rollError && <small className="field-error">{rollError}</small>}
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy || !!nameError || !!rollError}>
                Save
              </button>
            </div>
          </form>
        ) : (
          <dl className="details card-pad">
            <div>
              <dt>Registered</dt>
              <dd>{formatDateTime(s.createdAt, timezone)}</dd>
            </div>
            <div>
              <dt>Face samples</dt>
              <dd>{s.sampleCount}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{formatDateTime(s.updatedAt, timezone)}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Face registration</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => setReenroll(true)}>
            <Icon name="camera" size={16} /> Re-register face
          </button>
        </div>
        <p className="muted card-pad">
          Replaces all stored face samples for this user. Use this if recognition is unreliable or appearance has
          changed significantly.
        </p>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Recent attendance</h2>
          <Link className="link" to={`/admin/attendance?studentId=${s._id}`}>
            View all
          </Link>
        </div>
        {data.recentAttendance.length === 0 ? (
          <EmptyState icon="calendar" title="No attendance recorded yet" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.recentAttendance.map((r) => (
                <tr key={r._id}>
                  <td>{formatDayKey(r.dayKey)}</td>
                  <td>{formatTime(r.checkInAt, timezone)}</td>
                  <td>
                    <Pill kind={r.status === 'Late' ? 'warning' : 'success'}>{r.status}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card danger-zone">
        <div className="card-header">
          <h2>Danger zone</h2>
        </div>
        <div className="card-pad danger-actions">
          {s.active ? (
            <button className="btn btn-ghost" onClick={() => setConfirm('deactivate')}>
              Deactivate user
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={() => setActive(true)} disabled={busy}>
              Activate user
            </button>
          )}
          <button className="btn btn-danger" onClick={() => setConfirm('delete')}>
            <Icon name="trash" size={16} /> Delete user
          </button>
        </div>
      </section>

      {confirm === 'deactivate' && (
        <ConfirmDialog
          title="Deactivate user?"
          message={`${s.name} will no longer be recognized at the kiosk. Their attendance history is kept.`}
          confirmLabel="Deactivate"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => setActive(false)}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          danger
          title="Delete user permanently?"
          message={`This permanently deletes ${s.name} (${s.rollNo}) and their face data. Attendance history is kept for records. This cannot be undone.`}
          confirmLabel="Delete permanently"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={remove}
        />
      )}
      {reenroll && (
        <Modal title={`Re-register face — ${s.name}`} onClose={busy ? undefined : () => setReenroll(false)}>
          {busy ? (
            <Spinner label="Verifying and saving..." />
          ) : (
            <FaceCapture onCancel={() => setReenroll(false)} onComplete={(samples) => uploadFace(samples)} />
          )}
        </Modal>
      )}
      {duplicate && (
        <DuplicateWarning
          matches={duplicate}
          busy={busy}
          onCancel={() => {
            setDuplicate(null);
            setPendingSamples(null);
          }}
          onConfirm={() => uploadFace(pendingSamples, true)}
        />
      )}
    </div>
  );
}
