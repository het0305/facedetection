import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { ConfirmDialog, EmptyState, Icon, Notice, Pagination, Pill, Spinner } from '../../components/ui';
import { formatDayKey, formatTime, todayKey } from '../../utils/format';
import { useSystem } from './AdminLayout';

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function Attendance() {
  const { timezone } = useSystem();
  const [params] = useSearchParams();
  const studentId = params.get('studentId') || undefined;
  const today = todayKey(timezone);
  const [from, setFrom] = useState(studentId ? '' : today);
  const [to, setTo] = useState(studentId ? '' : today);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounced(search);

  const filters = { from, to, search: q, status, studentId };

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.get('/attendance', { from, to, search: q, status, studentId, page, limit: 25 }));
    } catch (err) {
      setError(err.message);
    }
  }, [from, to, q, status, studentId, page]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [from, to, q, status]);

  const changeStatus = async (record, next) => {
    try {
      await api.patch(`/attendance/${record._id}`, { status: next });
      setNotice(`Status for ${record.studentName} changed to ${next}.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/attendance/${toDelete._id}`);
      setNotice(`Attendance record for ${toDelete.studentName} deleted.`);
      setToDelete(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const exportHref = api.url('/attendance/export', { from, to, search: q, status, studentId });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Attendance</h1>
          <p className="muted">Times shown in {timezone || 'server time'}.</p>
        </div>
        <a className="btn btn-primary" href={exportHref} download>
          <Icon name="download" size={16} /> Export Excel
        </a>
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

      <section className="card">
        <div className="toolbar">
          <label className="field-inline">
            <span>From</span>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field-inline">
            <span>To</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="search">
            <Icon name="search" size={16} />
            <input
              type="search"
              placeholder="Name or ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={100}
              aria-label="Search attendance"
            />
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
            <option value="">All statuses</option>
            <option value="Present">Present</option>
            <option value="Late">Late</option>
          </select>
          {(from !== today || to !== today || filters.search || status) && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setFrom(today);
                setTo(today);
                setSearch('');
                setStatus('');
              }}
            >
              Reset
            </button>
          )}
        </div>

        {!data ? (
          <Spinner label="Loading attendance..." />
        ) : data.items.length === 0 ? (
          <EmptyState icon="calendar" title="No attendance records for these filters" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>ID</th>
                    <th>Check-in</th>
                    <th>Status</th>
                    <th>Verification</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r._id}>
                      <td>{formatDayKey(r.dayKey)}</td>
                      <td>{r.studentName}</td>
                      <td className="mono">{r.rollNo}</td>
                      <td>{formatTime(r.checkInAt, timezone)}</td>
                      <td>
                        <select
                          className={`status-select ${r.status === 'Late' ? 'late' : ''}`}
                          value={r.status}
                          onChange={(e) => changeStatus(r, e.target.value)}
                          aria-label={`Status for ${r.studentName}`}
                        >
                          <option>Present</option>
                          <option>Late</option>
                        </select>
                      </td>
                      <td>
                        {r.source === 'legacy' ? (
                          <Pill>Legacy</Pill>
                        ) : r.verification?.confidence ? (
                          <Pill kind={r.verification.confidence === 'high' ? 'success' : 'info'}>
                            {r.verification.confidence === 'high' ? 'High confidence' : 'Verified'}
                            {r.verification.liveness != null ? ' · live' : ''}
                          </Pill>
                        ) : (
                          <Pill>{r.source}</Pill>
                        )}
                      </td>
                      <td className="num">
                        <button className="icon-btn danger" onClick={() => setToDelete(r)} aria-label={`Delete record for ${r.studentName}`}>
                          <Icon name="trash" size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />
          </>
        )}
      </section>

      {toDelete && (
        <ConfirmDialog
          danger
          title="Delete attendance record?"
          message={`Delete the ${formatDayKey(toDelete.dayKey)} check-in for ${toDelete.studentName} (${toDelete.rollNo})? This is recorded in the audit log.`}
          confirmLabel="Delete record"
          busy={busy}
          onCancel={() => setToDelete(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}
