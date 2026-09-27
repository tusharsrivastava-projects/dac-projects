import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Field-level encryption for the things a lister hands over that should never
 * sit in the database as plain text: bank account number, ID numbers, the
 * settlement UPI handle. AES-256-GCM with a random IV per value.
 *
 * The key comes from DATA_KEY (64 hex chars). Without it, one is generated
 * into the data directory on first boot. That keeps local development
 * zero-config, but means the key lives next to the database — set DATA_KEY
 * as a secret on any real deployment.
 */
let key = null;

function loadKey() {
  if (key) return key;
  const fromEnv = process.env.DATA_KEY || '';
  if (/^[0-9a-f]{64}$/i.test(fromEnv)) {
    key = Buffer.from(fromEnv, 'hex');
    return key;
  }
  const file = path.join(config.dataDir, '.data-key');
  if (fs.existsSync(file)) {
    key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  } else {
    key = crypto.randomBytes(32);
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, key.toString('hex'), { mode: 0o600 });
    if (config.production) {
      console.warn('  !!! DATA_KEY is not set. Generated one in the data directory; set DATA_KEY so bank details survive a redeploy.');
    }
  }
  return key;
}

export function seal(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${body.toString('base64url')}`;
}

export function open(sealed) {
  if (!sealed) return null;
  const [version, iv, tag, body] = String(sealed).split(':');
  if (version !== 'v1') return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null; // wrong key or tampered value; never throw into a page render
  }
}

/** "XXXXXX4821" — enough for an admin to match a statement, not enough to reuse. */
export const mask = (value, visible = 4) => {
  const v = String(value || '');
  if (!v) return null;
  return v.length <= visible ? v : `${'•'.repeat(Math.min(8, v.length - visible))}${v.slice(-visible)}`;
};
