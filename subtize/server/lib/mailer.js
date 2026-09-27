import { db } from '../db/index.js';
import { config } from '../config.js';

let transportPromise = null;

async function getTransport() {
  if (!config.smtp.host) return null;
  if (!transportPromise) {
    transportPromise = import('nodemailer').then(({ default: nodemailer }) =>
      nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      }),
    );
  }
  return transportPromise;
}

export const smtpConfigured = () => Boolean(config.smtp.host);

/**
 * Codes are only ever shown on screen when there is no way to deliver them
 * and this is not production — the local demo keeps working, a live site
 * never leaks one.
 */
export const echoCodes = () => !smtpConfigured() && !config.production;

/** Records the message, then tries SMTP. Never throws into a request. */
export async function sendMail({ to, subject, text }) {
  const id = db.prepare('INSERT INTO mail_outbox (to_email, subject, body_text) VALUES (?, ?, ?)')
    .run(to, subject, text).lastInsertRowid;
  const transport = await getTransport();
  if (!transport) return { id, delivered: false };
  try {
    await transport.sendMail({ from: config.smtp.from, to, subject, text });
    db.prepare("UPDATE mail_outbox SET status = 'sent', sent_at = datetime('now') WHERE id = ?").run(id);
    return { id, delivered: true };
  } catch (err) {
    db.prepare("UPDATE mail_outbox SET status = 'failed', error = ? WHERE id = ?").run(String(err?.message || err).slice(0, 400), id);
    console.error(`[mail] delivery to ${to} failed:`, err?.message || err);
    return { id, delivered: false };
  }
}
