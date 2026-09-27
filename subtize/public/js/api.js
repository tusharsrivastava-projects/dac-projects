/* Thin fetch wrapper. Every call resolves with parsed JSON or throws ApiError. */

export class ApiError extends Error {
  constructor(status, message, details = null, body = null) {
    super(message);
    this.status = status;
    this.details = details;
    this.body = body;
  }
}

async function request(method, url, body, { raw = false } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opts); } catch { throw new ApiError(0, 'You appear to be offline. Check your connection and try again.'); }
  if (raw) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status}).`, data?.details || null, data);
  return data;
}

export const api = {
  get: (url, params) => {
    if (params) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)) continue;
        q.set(k, Array.isArray(v) ? v.join(',') : v === true ? '1' : v);
      }
      const s = q.toString();
      if (s) url += (url.includes('?') ? '&' : '?') + s;
    }
    return request('GET', url);
  },
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url, body) => request('DELETE', url, body),
  upload: (url, formData, method = 'POST') => request(method, url, formData),
  raw: (url) => request('GET', url, undefined, { raw: true }),
  me: () => request('GET', '/api/auth/me'),
  logout: () => request('POST', '/api/auth/logout'),
};

/** Sends someone to sign in and back here afterwards. */
export const toLogin = () => {
  const next = encodeURIComponent(location.pathname + location.search + location.hash);
  location.href = `/login?next=${next}`;
};

/** Where each role belongs. Matches the server's dashboardFor(). */
export const homeFor = (role) => (role === 'admin' ? '/admin' : role === 'lister' ? '/lister' : '/app');
