import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAdmin } from './auth/AuthContext';
import Home from './pages/Home';
import Login from './pages/Login';
import Kiosk from './pages/Kiosk';
import AdminLayout from './pages/admin/AdminLayout';
import Dashboard from './pages/admin/Dashboard';
import Students from './pages/admin/Students';
import StudentDetail from './pages/admin/StudentDetail';
import RegisterStudent from './pages/admin/RegisterStudent';
import Attendance from './pages/admin/Attendance';
import Settings from './pages/admin/Settings';
import { EmptyState } from './components/ui';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/kiosk" element={<Kiosk />} />
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="students" element={<Students />} />
        <Route path="students/new" element={<RegisterStudent />} />
        <Route path="students/:id" element={<StudentDetail />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      {/* Paths from the previous version of the app */}
      <Route path="/register" element={<Navigate to="/admin/students/new" replace />} />
      <Route path="/attendance" element={<Navigate to="/kiosk" replace />} />
      <Route path="/records" element={<Navigate to="/admin/attendance" replace />} />
      <Route
        path="*"
        element={
          <div className="full-center">
            <EmptyState title="Page not found">
              <a href="/">Go to the home page</a>
            </EmptyState>
          </div>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
