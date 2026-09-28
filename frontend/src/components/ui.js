import React, { useEffect, useRef } from 'react';

// Stroke icons (24x24, lucide-style paths) so no icon font or CDN is needed.
const PATHS = {
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  info: 'M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  userPlus: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm10-3v6m3-3h-6',
  scan: 'M3 7V5a2 2 0 0 1 2-2h2m10 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  camera: 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3ZM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  clock: 'M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  calendar: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-2.2-1.3L14.3 3h-4l-.4 2.5a7.3 7.3 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 0 0 2.2 1.3l.4 2.5h4l.4-2.5a7.3 7.3 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3',
  search: 'M21 21l-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z',
  arrowLeft: 'M19 12H5m7 7-7-7 7-7',
  arrowRight: 'M5 12h14m-7-7 7 7-7 7',
  chevronLeft: 'm15 18-6-6 6-6',
  chevronRight: 'm9 18 6-6-6-6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  shieldAlert: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm0-14v4m0 4h.01',
  trash: 'M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  plus: 'M12 5v14m-7-7h14',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4L21 8m0-5v5h-5',
  monitor: 'M20 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2ZM8 21h8m-4-4v4',
  lock: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2ZM7 11V7a5 5 0 0 1 10 0v4',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2ZM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
};

export function Icon({ name, size = 20, className = '', strokeWidth = 2, title }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name] || PATHS.info} />
    </svg>
  );
}

export function Spinner({ label, full = false, size = 22 }) {
  const el = (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" style={{ width: size, height: size }} />
      {label && <span className="spinner-label">{label}</span>}
    </div>
  );
  return full ? <div className="full-center">{el}</div> : el;
}

export function Notice({ kind = 'info', title, children, onClose }) {
  const icon = { info: 'info', success: 'check', warning: 'alert', danger: 'alert' }[kind];
  return (
    <div className={`notice notice-${kind}`} role={kind === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon} size={18} />
      <div className="notice-body">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {onClose && (
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Dismiss">
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}

export function Pill({ kind = 'neutral', children }) {
  return <span className={`pill pill-${kind}`}>{children}</span>;
}

export function EmptyState({ icon = 'info', title, children }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={24} />
      </div>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Pagination({ page, pages, total, onPage }) {
  if (!total) return null;
  return (
    <div className="pagination">
      <span className="muted">
        {total} record{total === 1 ? '' : 's'}
      </span>
      <div className="pagination-controls">
        <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <Icon name="chevronLeft" size={16} /> Previous
        </button>
        <span className="muted">
          Page {page} of {pages}
        </span>
        <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next <Icon name="chevronRight" size={16} />
        </button>
      </div>
    </div>
  );
}

export function Modal({ title, children, onClose, footer, labelledBy = 'modal-title' }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose && onClose();
    document.addEventListener('keydown', onKey);
    const first = ref.current && ref.current.querySelector('button, input, select, textarea');
    if (first) first.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>
        <div className="modal-header">
          <h2 id={labelledBy}>{title}</h2>
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, busy, onConfirm, onCancel }) {
  return (
    <Modal
      title={title}
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working...' : confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}
