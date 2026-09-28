import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { EmptyState, Notice, Pagination, Pill, Spinner } from '../../components/ui';
import { formatDateTime } from '../../utils/format';
import { useSystem } from './AdminLayout';

function PasswordForm() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const mismatch = form.confirm && form.newPassword !== form.confirm;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setMsg({ kind: 'success', text: 'Password changed. Other sessions have been signed out.' });
    } catch (err) {
      setMsg({ kind: 'danger', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2>Change password</h2>
      </div>
      <form className="form card-pad" onSubmit={submit}>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <label className="field">
          <span>Current password</span>
          <input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required />
        </label>
        <label className="field">
          <span>New password</span>
          <input type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} minLength={10} required />
          <small className="muted">At least 10 characters, including letters and numbers.</small>
        </label>
        <label className="field">
          <span>Confirm new password</span>
          <input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required />
          {mismatch && <small className="field-error">Passwords do not match.</small>}
        </label>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy || mismatch || !form.newPassword}>
            {busy ? 'Saving...' : 'Change password'}
          </button>
        </div>
      </form>
    </section>
  );
}

function Devices() {
  const { timezone } = useSystem();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => api.get('/admin/devices').then((r) => setItems(r.items)).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);
  const toggle = async (d) => {
    try {
      await api.patch(`/admin/devices/${d._id}`, { active: !d.active });
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <section className="card">
      <div className="card-header">
        <h2>Kiosk devices</h2>
      </div>
      <p className="muted card-pad">
        To add a kiosk, sign in on that device and open the kiosk page. Revoking a device stops it from recording
        attendance immediately.
      </p>
      {error && <Notice kind="danger">{error}</Notice>}
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon="monitor" title="No kiosk devices activated yet" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Activated</th>
              <th>Last seen</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d._id}>
                <td>{d.name}</td>
                <td>{formatDateTime(d.createdAt, timezone)}</td>
                <td>{d.lastSeenAt ? formatDateTime(d.lastSeenAt, timezone) : '—'}</td>
                <td>{d.active ? <Pill kind="success">Active</Pill> : <Pill kind="danger">Revoked</Pill>}</td>
                <td className="num">
                  <button className={`btn btn-sm ${d.active ? 'btn-ghost' : 'btn-ghost'}`} onClick={() => toggle(d)}>
                    {d.active ? 'Revoke' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const CATEGORY_KIND = { security: 'danger', auth: 'info', admin: 'neutral', system: 'neutral' };

function AuditLog() {
  const { timezone } = useSystem();
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api
      .get('/admin/audit', { category, page, limit: 20 })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [category, page]);
  return (
    <section className="card">
      <div className="card-header">
        <h2>Audit log</h2>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
          aria-label="Category"
        >
          <option value="">All events</option>
          <option value="admin">Administrative</option>
          <option value="auth">Sign-in</option>
          <option value="security">Security</option>
        </select>
      </div>
      {error && <Notice kind="danger">{error}</Notice>}
      {!data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <EmptyState title="No events" />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>By</th>
                  <th>Record</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a._id}>
                    <td className="nowrap">{formatDateTime(a.createdAt, timezone)}</td>
                    <td>
                      <Pill kind={CATEGORY_KIND[a.category]}>{a.category}</Pill> <span className="mono">{a.action}</span>
                    </td>
                    <td>{a.actor?.label || a.actor?.type}</td>
                    <td>{a.target?.label || (a.details?.username ? `user: ${a.details.username}` : '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />
        </>
      )}
    </section>
  );
}

function SystemInfo() {
  const sys = useSystem();
  if (!sys.engine) return null;
  return (
    <section className="card">
      <div className="card-header">
        <h2>System</h2>
      </div>
      <dl className="details card-pad">
        <div>
          <dt>Face engine</dt>
          <dd>{sys.engine.ready ? `Ready (${sys.engine.backend})` : 'Not ready'}</dd>
        </div>
        <div>
          <dt>Liveness</dt>
          <dd>
            {sys.liveness.enabled ? `Passive (${sys.liveness.models.length} models)` : 'Disabled'}
            {sys.liveness.challenge.length ? ` + challenge: ${sys.liveness.challenge.join(', ')}` : ''}
          </dd>
        </div>
        <div>
          <dt>Registered identities loaded</dt>
          <dd>{sys.galleryIdentities}</dd>
        </div>
        <div>
          <dt>Recognition threshold</dt>
          <dd className="mono">
            {sys.recognition.threshold} (margin {sys.recognition.minMargin}, {sys.recognition.stableFrames} stable frames)
          </dd>
        </div>
        <div>
          <dt>Time zone</dt>
          <dd>
            {sys.timezone}
            {sys.lateAfter ? ` · late after ${sys.lateAfter}` : ''}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export default function Settings() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
        </div>
      </div>
      <div className="grid-2">
        <PasswordForm />
        <SystemInfo />
      </div>
      <Devices />
      <AuditLog />
    </div>
  );
}
