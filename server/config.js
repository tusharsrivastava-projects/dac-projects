import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

const int = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);

export const config = {
  port: int(process.env.PORT, 4000),
  host: process.env.HOST || '0.0.0.0',
  publicDir: path.join(ROOT, 'public'),
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  get uploadDir() {
    return path.join(this.dataDir, 'uploads');
  },
  get dbFile() {
    return process.env.DB_FILE || path.join(this.dataDir, 'dac-hrm.sqlite');
  },

  // Sessions
  sessionCookie: 'dac_session',
  sessionDays: int(process.env.SESSION_DAYS, 7),

  // Audio uploads
  maxAudioBytes: int(process.env.MAX_AUDIO_MB, 25) * 1024 * 1024,
  allowedAudioTypes: [
    'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4',
    'audio/wav', 'audio/x-wav', 'audio/aac', 'video/webm',
  ],

  // Where offer links point. RENDER_EXTERNAL_URL is set automatically on
  // Render, so a deploy there gets correct links with no configuration.
  baseUrl: (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),

  // Optional SMTP. Without it, mail is written to the in-app outbox only.
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: String(process.env.SMTP_SECURE || '') === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'DAC Talent <no-reply@dgu-ai-cell.local>',
  },

  org: {
    name: process.env.ORG_NAME || 'DAC — DGU AI Cell',
    shortName: 'DAC',
    parent: process.env.ORG_PARENT || 'DBS Global University',
    address: process.env.ORG_ADDRESS || 'Dehradun, Uttarakhand, India',
    signatory: process.env.ORG_SIGNATORY || 'Head of Talent',
    signatoryName: process.env.ORG_SIGNATORY_NAME || 'DAC Hiring Office',
    website: process.env.ORG_WEBSITE || 'https://dgu.ac.in',
  },

  seedAdmin: {
    email: (process.env.ADMIN_EMAIL || 'admin@dgu.ac.in').toLowerCase(),
    password: process.env.ADMIN_PASSWORD || 'dac-admin-2026',
    name: process.env.ADMIN_NAME || 'DAC Administrator',
  },
};
