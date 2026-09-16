import { badRequest } from './http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function str(value, field, { required = true, min = 0, max = 5000, trim = true } = {}) {
  let v = value == null ? '' : String(value);
  if (trim) v = v.trim();
  if (!v) {
    if (required) throw badRequest(`${field} is required.`, { field });
    return null;
  }
  if (v.length < min) throw badRequest(`${field} must be at least ${min} characters.`, { field });
  if (v.length > max) throw badRequest(`${field} must be under ${max} characters.`, { field });
  return v;
}

export function email(value, field = 'Email') {
  const v = str(value, field).toLowerCase();
  if (!EMAIL_RE.test(v)) throw badRequest(`${field} does not look like a valid address.`, { field });
  return v;
}

export function password(value, field = 'Password') {
  const v = str(value, field, { min: 8, max: 200, trim: false });
  if (!/[a-zA-Z]/.test(v) || !/[0-9]/.test(v)) {
    throw badRequest('Password needs at least one letter and one number.', { field });
  }
  return v;
}

export function int(value, field, { min = -Infinity, max = Infinity, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw badRequest(`${field} is required.`, { field });
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`${field} must be a whole number.`, { field });
  if (n < min || n > max) throw badRequest(`${field} must be between ${min} and ${max}.`, { field });
  return n;
}

export function num(value, field, { min = -Infinity, max = Infinity, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw badRequest(`${field} is required.`, { field });
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${field} must be a number.`, { field });
  if (n < min || n > max) throw badRequest(`${field} must be between ${min} and ${max}.`, { field });
  return n;
}

export function oneOf(value, field, allowed) {
  const v = str(value, field);
  if (!allowed.includes(v)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}.`, { field });
  }
  return v;
}

export function url(value, field, { required = false } = {}) {
  const v = str(value, field, { required, max: 500 });
  if (!v) return null;
  try {
    const parsed = new URL(v);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
    return parsed.toString();
  } catch {
    throw badRequest(`${field} must be a valid http(s) link.`, { field });
  }
}

/** Accepts YYYY-MM-DD and nothing else. */
export function isoDate(value, field, { required = false } = {}) {
  const v = str(value, field, { required, max: 10 });
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw badRequest(`${field} must be a date like 2026-07-01.`, { field });
  }
  return v;
}
