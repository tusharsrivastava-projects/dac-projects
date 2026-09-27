import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

// A local .env is optional; real deployments set variables in the environment.
if (fs.existsSync(path.join(ROOT, '.env')) && typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(ROOT, '.env'));

const int = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : fallback);

export const config = {
  port: int(process.env.PORT, 4600),
  host: process.env.HOST || '0.0.0.0',
  publicDir: path.join(ROOT, 'public'),
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  get uploadDir() {
    return path.join(this.dataDir, 'uploads');
  },
  get dbFile() {
    return process.env.DB_FILE || path.join(this.dataDir, 'subtize.sqlite');
  },
  production: process.env.NODE_ENV === 'production',

  sessionCookie: 'subtize_session',
  sessionDays: int(process.env.SESSION_DAYS, 14),

  // Where share links, card QR codes and agreement links point.
  baseUrl: (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),

  maxUploadBytes: int(process.env.MAX_UPLOAD_MB, 5) * 1024 * 1024,

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: String(process.env.SMTP_SECURE || '') === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Subtize.ai <no-reply@subtize.ai>',
  },

  // Optional. With a key set, the AI search asks Claude to read the query;
  // without one it uses the built-in parser, which covers the common phrasings.
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
  },

  // Defaults for the official collection account. Admins can change these in
  // Settings; each service can also point at its own official Subtize VPA.
  platform: {
    upiId: process.env.PLATFORM_UPI_ID || 'subtize.collect@okaxis',
    payee: process.env.PLATFORM_PAYEE || 'Subtize.ai Payments',
    commissionPercent: int(process.env.COMMISSION_PERCENT, 20),
    supportEmail: process.env.SUPPORT_EMAIL || 'support@subtize.ai',
    supportPhone: process.env.SUPPORT_PHONE || '+91 135 000 0000',
    defaultCity: process.env.DEFAULT_CITY || 'Dehradun',
  },

  seedAdmin: {
    email: (process.env.ADMIN_EMAIL || 'admin@subtize.ai').toLowerCase(),
    password: process.env.ADMIN_PASSWORD || 'subtize-admin-2026',
    name: process.env.ADMIN_NAME || 'Subtize Administrator',
  },
};
