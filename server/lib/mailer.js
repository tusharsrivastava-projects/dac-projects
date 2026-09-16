import { db } from '../db/index.js';
import { config } from '../config.js';

let transportPromise = null;

/**
 * SMTP is optional. With no SMTP_HOST configured every message still lands in
 * mail_outbox, which the admin console renders — so the flow is testable
 * end to end without wiring a mail provider first.
 */
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
 * Queues a message, then tries to deliver it. Returns the outbox row id and
 * whether it actually went out over SMTP.
 */
export async function sendMail({ to, toName = null, subject, html, text = null, kind = null, relatedId = null }) {
  const id = db.prepare(
    `INSERT INTO mail_outbox (to_email, to_name, subject, body_html, body_text, kind, related_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(to, toName, subject, html, text, kind, relatedId).lastInsertRowid;

  const transport = await getTransport();
  if (!transport) {
    db.prepare("UPDATE mail_outbox SET status = 'queued', provider = 'outbox' WHERE id = ?").run(id);
    console.log(`[mail] queued to outbox (no SMTP configured) → ${to}: ${subject}`);
    return { id, delivered: false };
  }

  try {
    await transport.sendMail({
      from: config.smtp.from,
      to: toName ? `${toName} <${to}>` : to,
      subject,
      html,
      text: text || undefined,
    });
    db.prepare("UPDATE mail_outbox SET status = 'sent', provider = 'smtp', sent_at = datetime('now') WHERE id = ?").run(id);
    return { id, delivered: true };
  } catch (err) {
    db.prepare("UPDATE mail_outbox SET status = 'failed', provider = 'smtp', error = ? WHERE id = ?")
      .run(String(err?.message || err).slice(0, 500), id);
    console.error(`[mail] SMTP delivery failed for ${to}:`, err?.message || err);
    return { id, delivered: false, error: String(err?.message || err) };
  }
}
