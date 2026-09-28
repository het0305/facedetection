import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { EmptyState, Icon, Notice, Pagination, Pill, Spinner } from '../../components/ui';
import { formatDate } from '../../utils/format';
import { useSystem } from './AdminLayout';

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Duplicates() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.get('/students/duplicates').then(setData).catch((e) => setError(e.message));
  }, []);
  if (error) return <Notice kind="danger">{error}</Notice>;
  if (!data) return <Spinner label="Comparing registered faces..." />;
  if (!data.pairs.length) return <EmptyState icon="check" title="No possible duplicates found" />;
  return (
    <section className="card">
      <div className="card-header">
        <h2>Possible duplicate registrations</h2>
      </div>
      <p className="muted card-pad">
        These users have very similar faces. If they are the same person, keep one record and delete or deactivate
        the others. If they are different people (e.g. twins), re-register both with the guided capture.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>User A</th>
            <th>User B</th>
            <th className="num">Similarity distance</th>
          </tr>
        </thead>
        <tbody>
          {data.pairs.map((p, i) => (
            <tr key={i}>
              <td>
                <Link to={`/admin/students/${p.a.id}`}>{p.a.name}</Link> <span className="mono muted">{p.a.rollNo}</span>
              </td>
              <td>
                <Link to={`/admin/students/${p.b.id}`}>{p.b.name}</Link> <span className="mono muted">{p.b.rollNo}</span>
              </td>
              <td className="num mono">{p.distance.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function Students() {
  const { timezone } = useSystem();
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') || '';
  const [search, setSearch] = useState(params.get('search') || '');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const q = useDebounced(search);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(
        await api.get('/students', {
          search: q,
          status,
          page,
          limit: 20,
          needsReenroll: filter === 'reenroll' ? 'true' : undefined,
        })
      );
    } catch (err) {
      setError(err.message);
    }
  }, [q, status, page, filter]);

  useEffect(() => {
    if (filter !== 'duplicates') load();
  }, [load, filter]);
  useEffect(() => setPage(1), [q, status, filter]);

  const setFilter = (f) => setParams(f ? { filter: f } : {});

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p className="muted">Registered people who can check in with their face.</p>
        </div>
        <Link to="/admin/students/new" className="btn btn-primary">
          <Icon name="userPlus" size={16} /> Register user
        </Link>
      </div>

      <div className="tabs" role="tablist">
        {[
          ['', 'All users'],
          ['reenroll', 'Needs re-registration'],
          ['duplicates', 'Possible duplicates'],
        ].map(([f, label]) => (
          <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
      </div>

      {filter === 'duplicates' ? (
        <Duplicates />
      ) : (
        <section className="card">
          <div className="toolbar">
            <label className="search">
              <Icon name="search" size={16} />
              <input
                type="search"
                placeholder="Search by name or ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={100}
                aria-label="Search users"
              />
            </label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          {error && <Notice kind="danger">{error}</Notice>}
          {!data ? (
            <Spinner label="Loading users..." />
          ) : data.items.length === 0 ? (
            <EmptyState icon="users" title={q || filter ? 'No matching users' : 'No users registered yet'}>
              {!q && !filter && <Link to="/admin/students/new">Register the first user</Link>}
            </EmptyState>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>ID</th>
                      <th>Face samples</th>
                      <th>Status</th>
                      <th>Registered</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((s) => (
                      <tr key={s._id}>
                        <td>
                          <Link to={`/admin/students/${s._id}`}>{s.name}</Link>
                        </td>
                        <td className="mono">{s.rollNo}</td>
                        <td>
                          {s.sampleCount}
                          {(s.hasLegacySample || s.sampleCount < 3) && (
                            <>
                              {' '}
                              <Pill kind="warning">Re-register</Pill>
                            </>
                          )}
                        </td>
                        <td>{s.active ? <Pill kind="success">Active</Pill> : <Pill>Inactive</Pill>}</td>
                        <td>{formatDate(s.createdAt, timezone)}</td>
                        <td className="num">
                          <Link to={`/admin/students/${s._id}`} className="btn btn-ghost btn-sm">
                            Manage
                          </Link>
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
      )}
    </div>
  );
}
