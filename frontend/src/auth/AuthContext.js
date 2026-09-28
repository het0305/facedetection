import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { Spinner } from '../components/ui';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, admin: null, kiosk: null, error: null });

  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/auth/me');
      setState({ loading: false, admin: me.admin, kiosk: me.kiosk, error: null });
    } catch (err) {
      setState({ loading: false, admin: null, kiosk: null, error: err.message });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (username, password) => {
      await api.post('/auth/login', { username, password });
      await refresh();
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      await refresh();
    }
  }, [refresh]);

  const value = useMemo(() => ({ ...state, refresh, login, logout }), [state, refresh, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export function RequireAdmin({ children }) {
  const { loading, admin } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner full label="Loading..." />;
  if (!admin) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}
