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

export function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

export function phone(value, field = 'Phone', { required = true } = {}) {
  const v = str(value, field, { required, max: 20 });
  if (!v) return null;
  const digits = v.replace(/[^\d]/g, '');
  if (digits.length < 10 || digits.length > 13) {
    throw badRequest(`${field} should be a 10-digit mobile number.`, { field });
  }
  return v;
}

/** Rupees in, paise out. Accepts "1,299" and "1299.50". */
export function rupees(value, field, { min = 1, max = 10_000_000, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return null;
    throw badRequest(`${field} is required.`, { field });
  }
  const n = Number(String(value).replace(/[,₹\s]/g, ''));
  if (!Number.isFinite(n)) throw badRequest(`${field} must be an amount in rupees.`, { field });
  if (n < min || n > max) throw badRequest(`${field} must be between ₹${min} and ₹${max}.`, { field });
  return Math.round(n * 100);
}

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Takes ['mon','wed'] or 'mon,wed' and returns a canonical, ordered CSV. */
export function days(value, field = 'Available days') {
  const list = (Array.isArray(value) ? value : String(value || '').split(','))
    .map((d) => String(d).trim().toLowerCase().slice(0, 3))
    .filter(Boolean);
  const bad = list.filter((d) => !DAYS.includes(d));
  if (bad.length) throw badRequest(`${field} has an unknown day: ${bad.join(', ')}.`, { field });
  const set = new Set(list);
  if (!set.size) throw badRequest(`Pick at least one day for ${field.toLowerCase()}.`, { field });
  return DAYS.filter((d) => set.has(d)).join(',');
}

/** Offered durations in months, e.g. '1,3,6'. Always includes at least one. */
export function planMonths(value) {
  const allowed = [1, 3, 6, 12];
  const list = (Array.isArray(value) ? value : String(value || '1').split(','))
    .map((m) => Number(String(m).trim())).filter((m) => allowed.includes(m));
  const set = [...new Set(list)].sort((a, b) => a - b);
  return (set.length ? set : [1]).join(',');
}

/** UPI transaction reference (UTR). Banks use 12 digits; some apps show longer alphanumerics. */
export function upiTxnId(value) {
  const v = str(value, 'UPI Transaction ID', { max: 40 }).replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{10,35}$/.test(v)) {
    throw badRequest('That does not look like a UPI Transaction ID. It is usually a 12-digit number on your payment receipt.', { field: 'upiTxnId' });
  }
  return v;
}

export function vpa(value, field = 'UPI ID', { required = true } = {}) {
  const v = str(value, field, { required, max: 80 });
  if (!v) return null;
  if (!/^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9.\-]{1,40}$/.test(v)) {
    throw badRequest(`${field} should look like name@bank.`, { field });
  }
  return v.toLowerCase();
}

export function ifsc(value, field = 'IFSC') {
  const v = str(value, field, { max: 11 }).toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v)) throw badRequest(`${field} should look like SBIN0001234.`, { field });
  return v;
}
