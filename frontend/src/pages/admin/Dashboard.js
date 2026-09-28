import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { EmptyState, Icon, Notice, Pill, Spinner } from '../../components/ui';
import { formatDayKey, formatTime } from '../../utils/format';
import { useSystem } from './AdminLayout';

function Stat({ label, value, icon, tone = 'neutral', to }) {
  const body = (
    <>
      <span className={`stat-icon tone-${tone}`}>
        <Icon name={icon} size={20} />
      </span>
      <span className="stat-value">{value ?? '–'}</span>
      <span className="stat-label">{label}</span>
    </>
  );
  return to ? (
    <Link to={to} className="stat">
      {body}
    </Link>
  ) : (
    <div className="stat">{body}</div>
  );
}

export default function Dashboard() {
  const { timezone } = useSystem();
  const [data, setData] = useState(null);
  const [dups, setDups] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get('/admin/dashboard'));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    api.get('/students/duplicates').then(setDups).catch(() => {});
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (error && !data) return <Notice kind="danger">{error}</Notice>;
  if (!data) return <Spinner label="Loading dashboard..." />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            {formatDayKey(data.today)} · {data.timezone}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={load}>
          <Icon name="refresh" size={16} /> Refresh
        </button>
      </div>

      {data.needsReenroll > 0 && (
        <Notice kind="warning" title={`${data.needsReenroll} user(s) should be re-registered`}>
          They were registered with a single photo under the old system. Re-register their face with the guided
          capture to improve accuracy. <Link to="/admin/students?filter=reenroll">Review users</Link>
        </Notice>
      )}
      {dups && dups.pairs.length > 0 && (
        <Notice kind="danger" title={`${dups.pairs.length} possible duplicate registration(s)`}>
          Some registered users look like the same person. Until this is resolved they may be reported as
          "Unable to verify identity". <Link to="/admin/students?filter=duplicates">Review duplicates</Link>
        </Notice>
      )}

      <div className="stats">
        <Stat label="Active users" value={data.totalActive} icon="users" to="/admin/students" />
        <Stat label="Present today" value={data.present} icon="check" tone="success" to="/admin/attendance" />
        <Stat label="Late today" value={data.late} icon="clock" tone="warning" />
        <Stat label="Absent today" value={data.absent} icon="x" tone="danger" />
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <h2>Today's check-ins</h2>
            <Link to="/admin/attendance" className="link">
              View all
            </Link>
          </div>
          {data.recent.length === 0 ? (
            <EmptyState icon="clock" title="No check-ins yet today" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>ID</th>
                  <th>Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr key={r._id}>
                    <td>{r.studentName}</td>
                    <td className="mono">{r.rollNo}</td>
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

        <section className="card">
          <div className="card-header">
            <h2>Last 7 days</h2>
          </div>
          {data.week.length === 0 ? (
            <EmptyState icon="calendar" title="No attendance in the last 7 days" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Check-ins</th>
                </tr>
              </thead>
              <tbody>
                {[...data.week].reverse().map((w) => (
                  <tr key={w.dayKey}>
                    <td>{formatDayKey(w.dayKey)}</td>
                    <td className="num">{w.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
