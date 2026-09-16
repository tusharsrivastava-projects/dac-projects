/** Thin fetch wrapper. Throws ApiError with the server's message on failure. */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, body, { raw = false } = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }

  if (raw) return res;
  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }

  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `Request failed (${res.status}).`, data?.details);
  }
  return data;
}

export const api = {
  get:   (p) => request('GET', p),
  post:  (p, b) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del:   (p) => request('DELETE', p),
  raw:   (m, p, b) => request(m, p, b, { raw: true }),

  me:     () => request('GET', '/api/auth/me'),
  login:  (email, password) => request('POST', '/api/auth/login', { email, password }),
  logout: () => request('POST', '/api/auth/logout'),
  register: (payload) => request('POST', '/api/auth/register', payload),
};
