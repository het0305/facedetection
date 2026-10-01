// Thin fetch wrapper. Sessions live in httpOnly cookies (never readable here);
// every request sends the CSRF header the server requires, and every failure
// becomes an ApiError with a message that is safe to show to users.
const BASE = process.env.REACT_APP_API_URL || '';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const FALLBACK = {
  0: 'Unable to reach the server. Please check your connection and try again.',
  401: 'Please sign in to continue.',
  403: 'You do not have permission to perform this action.',
  404: 'The requested record was not found.',
  413: 'The upload is too large.',
  429: 'Too many requests. Please wait a moment and try again.',
  500: 'Something went wrong. Please try again.',
};

function buildUrl(path, query) {
  const url = new URL(BASE + '/api' + path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }
  return BASE ? url.toString() : url.pathname + url.search;
}

async function request(method, path, { body, form, query, signal, file } = {}) {
  const headers = { 'X-Requested-With': 'XMLHttpRequest', Accept: file ? '*/*' : 'application/json' };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(buildUrl(path, query), { method, headers, body: payload, credentials: 'include', signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', FALLBACK[0]);
  }
  let data = null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const e = data && data.error;
    const status = res.status >= 500 ? 500 : res.status;
    throw new ApiError(res.status, e?.code || 'HTTP_' + res.status, e?.message || FALLBACK[status] || FALLBACK[500], e?.details);
  }
  if (file) {
    const match = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '');
    return { blob: await res.blob(), filename: match ? match[1] : 'download' };
  }
  return data;
}

// Downloads go through fetch (not a plain link) so they carry the API headers,
// reach the backend through the dev proxy, and surface errors to the page.
async function download(path, query) {
  const { blob, filename } = await request('GET', path, { query, file: true });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export const api = {
  get: (path, query, opts) => request('GET', path, { ...opts, query }),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  patch: (path, body) => request('PATCH', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  del: (path) => request('DELETE', path),
  upload: (path, form, opts) => request('POST', path, { ...opts, form }),
  uploadPut: (path, form, opts) => request('PUT', path, { ...opts, form }),
  download,
  url: buildUrl,
};
