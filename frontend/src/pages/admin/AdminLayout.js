import React, { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Icon } from '../../components/ui';

const SystemContext = createContext({ timezone: undefined });
export const useSystem = () => useContext(SystemContext);

const NAV = [
  { to: '/admin', end: true, icon: 'grid', label: 'Dashboard' },
  { to: '/admin/students', icon: 'users', label: 'Users' },
  { to: '/admin/students/new', icon: 'userPlus', label: 'Register user' },
  { to: '/admin/attendance', icon: 'list', label: 'Attendance' },
  { to: '/admin/settings', icon: 'settings', label: 'Settings' },
];

export default function AdminLayout() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const [system, setSystem] = useState({ timezone: undefined });
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api
      .get('/admin/system')
      .then(setSystem)
      .catch(() => {});
  }, []);

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <SystemContext.Provider value={system}>
      <div className="admin">
        <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
          <div className="sidebar-brand">
            <span className="brand-mark">
              <Icon name="scan" size={18} />
            </span>
            FaceAttend
            <button className="icon-btn sidebar-toggle" onClick={() => setMenuOpen((v) => !v)} aria-label="Toggle menu">
              <Icon name={menuOpen ? 'x' : 'list'} />
            </button>
          </div>
          <nav className="sidebar-nav" onClick={() => setMenuOpen(false)}>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end ?? n.to === '/admin/students'}>
                <Icon name={n.icon} size={18} />
                {n.label}
              </NavLink>
            ))}
            <a href="/kiosk" className="nav-kiosk">
              <Icon name="scan" size={18} />
              Open kiosk
            </a>
          </nav>
          <div className="sidebar-footer">
            <div className="sidebar-user">
              <Icon name="user" size={16} />
              {admin?.username}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onLogout}>
              <Icon name="logout" size={16} /> Sign out
            </button>
          </div>
        </aside>
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </SystemContext.Provider>
  );
}
