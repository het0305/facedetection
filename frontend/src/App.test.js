import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { AppRoutes } from './App';
import { api, ApiError } from './api/client';
import { validateName, validateRollNo } from './utils/format';

function json(status, body) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
  });
}

function mockApi(routes) {
  global.fetch = jest.fn((url, opts = {}) => {
    const key = `${opts.method || 'GET'} ${String(url).split('?')[0]}`;
    const handler = routes[key];
    if (!handler) return json(404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
    return typeof handler === 'function' ? handler(url, opts) : json(200, handler);
  });
}

async function renderAt(path) {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>
  );
  // Let the initial /auth/me request settle inside act().
  await act(async () => {});
  return view;
}

afterEach(() => {
  delete global.fetch;
});

test('home page offers kiosk and admin entry points', async () => {
  mockApi({ 'GET /api/auth/me': { admin: null, kiosk: null } });
  await renderAt('/');
  expect(screen.getByText('Attendance kiosk')).toBeInTheDocument();
  expect(screen.getByText('Admin console')).toBeInTheDocument();
});

test('admin pages redirect to sign-in when not authenticated', async () => {
  mockApi({ 'GET /api/auth/me': { admin: null, kiosk: null } });
  await renderAt('/admin/students');
  expect(await screen.findByText('Administrator sign in')).toBeInTheDocument();
});

test('legacy /records path goes to attendance (behind sign-in)', async () => {
  mockApi({ 'GET /api/auth/me': { admin: null, kiosk: null } });
  await renderAt('/records');
  expect(await screen.findByText('Administrator sign in')).toBeInTheDocument();
});

test('failed sign-in shows the server message and clears the password', async () => {
  mockApi({
    'GET /api/auth/me': { admin: null, kiosk: null },
    'POST /api/auth/login': () => json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' } }),
  });
  await renderAt('/login');
  await userEvent.type(screen.getByLabelText('Username'), 'admin');
  await userEvent.type(screen.getByLabelText('Password'), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('Invalid username or password.')).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toHaveValue('');
});

test('kiosk on an unactivated device explains what to do', async () => {
  mockApi({ 'GET /api/auth/me': { admin: null, kiosk: null } });
  await renderAt('/kiosk');
  expect(await screen.findByText('This device is not activated')).toBeInTheDocument();
});

test('signed-in admin sees the dashboard', async () => {
  mockApi({
    'GET /api/auth/me': { admin: { username: 'admin', role: 'admin' }, kiosk: null },
    'GET /api/admin/system': { timezone: 'UTC' },
    'GET /api/students/duplicates': { pairs: [] },
    'GET /api/admin/dashboard': {
      today: '2026-09-28',
      timezone: 'UTC',
      totalActive: 3,
      present: 2,
      late: 1,
      absent: 1,
      needsReenroll: 0,
      recent: [{ _id: '1', studentName: 'Asha Patel', rollNo: 'E1', checkInAt: '2026-09-28T09:00:00Z', status: 'Present' }],
      week: [],
    },
  });
  await renderAt('/admin');
  expect(await screen.findByText('Asha Patel')).toBeInTheDocument();
  expect(screen.getByText('Present today')).toBeInTheDocument();
});

test('api client sends the CSRF header and maps network failures to friendly errors', async () => {
  global.fetch = jest.fn(() => json(200, { ok: true }));
  await api.post('/x', { a: 1 });
  const [, opts] = global.fetch.mock.calls[0];
  expect(opts.headers['X-Requested-With']).toBe('XMLHttpRequest');
  expect(opts.credentials).toBe('include');

  global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
  await expect(api.get('/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK' });

  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: false, status: 500, headers: { get: () => 'text/html' }, json: () => Promise.reject() })
  );
  const err = await api.get('/x').catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.message).toBe('Something went wrong. Please try again.');
});

test('client-side validation mirrors the server rules', () => {
  expect(validateName('A')).toMatch(/at least 2/);
  expect(validateName('<script>')).toMatch(/only contain/);
  expect(validateName('José O\'Neil-Smith')).toBeNull();
  expect(validateRollNo('')).toMatch(/required/);
  expect(validateRollNo('EMP 1')).toMatch(/only contain/);
  expect(validateRollNo('EMP-001/A')).toBeNull();
});

test('pagination and empty states render', async () => {
  mockApi({
    'GET /api/auth/me': { admin: { username: 'admin', role: 'admin' }, kiosk: null },
    'GET /api/admin/system': { timezone: 'UTC' },
    'GET /api/students': { items: [], total: 0, page: 1, pages: 1 },
  });
  await renderAt('/admin/students');
  await waitFor(() => expect(screen.getByText('No users registered yet')).toBeInTheDocument());
});
