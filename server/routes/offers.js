import express from 'express';
import { config } from '../config.js';
import { db, logActivity } from '../db/index.js';
import { conflict, forbidden, notFound, wrap } from '../lib/http.js';
import { offerToken } from '../lib/ids.js';
import * as notify from '../lib/notify.js';
import { offerUrl, prettyDate, renderLetterBody, renderOfferEmail } from '../lib/offerLetter.js';
import * as v from '../lib/validate.js';
import { requireAdmin, requireAuth } from '../middleware/session.js';
import { loadApplication } from './applications.js';

export const offersRouter = express.Router();

const shape = (o, req = null) => ({
  id: o.id,
  applicationId: o.application_id,
  token: o.token,
  link: offerUrl(o.token, req),
  positionTitle: o.position_title,
  department: o.department,
  location: o.location,
  employmentType: o.employment_type,
  compensation: o.compensation,
  startDate: o.start_date,
  reportingTo: o.reporting_to,
  expiresOn: o.expires_on,
  extraTerms: o.extra_terms,
  status: o.status,
  sentAt: o.sent_at,
  acceptedAt: o.accepted_at,
  declinedAt: o.declined_at,
  declineReason: o.decline_reason,
  createdAt: o.created_at,
  candidate: o.candidate_name ? { fullName: o.candidate_name, email: o.candidate_email } : undefined,
  jobTitle: o.job_title,
});

const OFFER_SELECT = `
  SELECT o.*, u.full_name AS candidate_name, u.email AS candidate_email, j.title AS job_title
    FROM offers o
    JOIN applications a ON a.id = o.application_id
    JOIN users u ON u.id = a.candidate_id
    JOIN jobs  j ON j.id = a.job_id
`;

const loadOffer = (id) => db.prepare(`${OFFER_SELECT} WHERE o.id = ?`).get(id);
const loadOfferByToken = (token) => db.prepare(`${OFFER_SELECT} WHERE o.token = ?`).get(token);

const readOfferBody = (body, app, existing = {}) => ({
  position_title: v.str(body.positionTitle ?? existing.position_title ?? app.job_title, 'Position', { min: 2, max: 140 }),
  department: v.str(body.department ?? existing.department ?? app.job_dept, 'Team', { required: false, max: 140 }),
  location: v.str(body.location ?? existing.location, 'Location', { required: false, max: 140 }),
  employment_type: v.str(body.employmentType ?? existing.employment_type ?? app.job_type, 'Engagement', { required: false, max: 80 }),
  compensation: v.str(body.compensation ?? existing.compensation, 'Compensation', { min: 1, max: 140 }),
  start_date: v.isoDate(body.startDate ?? existing.start_date, 'Start date', { required: true }),
  reporting_to: v.str(body.reportingTo ?? existing.reporting_to, 'Reporting to', { required: false, max: 140 }),
  expires_on: v.isoDate(body.expiresOn ?? existing.expires_on, 'Offer validity'),
  extra_terms: v.str(body.extraTerms ?? existing.extra_terms, 'Additional terms', { required: false, max: 6000 }),
});

// ── Admin: draft an offer for an approved application ────────────────────────
offersRouter.post('/', requireAdmin, wrap((req, res) => {
  const applicationId = v.int(req.body.applicationId, 'Application', { min: 1 });
  const app = loadApplication(applicationId);
  if (!app) throw notFound('That application does not exist.');
  if (!['approved', 'offer_sent'].includes(app.stage)) {
    throw conflict('Approve the application before drafting an offer letter.');
  }
  if (db.prepare('SELECT 1 FROM offers WHERE application_id = ?').get(applicationId)) {
    throw conflict('This application already has an offer. Edit that one instead.');
  }

  const payload = readOfferBody(req.body, app);
  const id = db.prepare(`
    INSERT INTO offers (application_id, token, position_title, department, location, employment_type,
                        compensation, start_date, reporting_to, expires_on, extra_terms, issued_by)
    VALUES (@application_id, @token, @position_title, @department, @location, @employment_type,
            @compensation, @start_date, @reporting_to, @expires_on, @extra_terms, @issued_by)
  `).run({
    ...payload,
    application_id: applicationId,
    token: offerToken(),
    issued_by: req.user.id,
  }).lastInsertRowid;

  logActivity({
    actorId: req.user.id, actorName: req.user.fullName, action: 'offer.drafted',
    entity: 'offer', entityId: id, detail: `${app.candidate_name} · ${payload.position_title}`,
  });
  res.status(201).json({ offer: shape(loadOffer(id), req) });
}));

offersRouter.get('/', requireAdmin, wrap((req, res) => {
  const rows = db.prepare(`${OFFER_SELECT} ORDER BY o.created_at DESC`).all();
  res.json({ offers: rows.map((o) => shape(o, req)) });
}));

offersRouter.get('/:id', requireAuth, wrap((req, res) => {
  const id = v.int(req.params.id, 'Offer id', { min: 1 });
  const offer = loadOffer(id);
  if (!offer) throw notFound('That offer does not exist.');
  const app = loadApplication(offer.application_id);
  if (req.user.role !== 'admin' && app.candidate_id !== req.user.id) throw forbidden('That offer is not yours.');
  res.json({ offer: shape(offer, req) });
}));

offersRouter.patch('/:id', requireAdmin, wrap((req, res) => {
  const id = v.int(req.params.id, 'Offer id', { min: 1 });
  const existing = loadOffer(id);
  if (!existing) throw notFound('That offer does not exist.');
  if (['accepted', 'declined'].includes(existing.status)) {
    throw conflict('The candidate has already responded to this offer.');
  }

  const app = loadApplication(existing.application_id);
  const payload = readOfferBody(req.body, app, existing);
  db.prepare(`
    UPDATE offers SET position_title = @position_title, department = @department, location = @location,
           employment_type = @employment_type, compensation = @compensation, start_date = @start_date,
           reporting_to = @reporting_to, expires_on = @expires_on, extra_terms = @extra_terms,
           updated_at = datetime('now')
     WHERE id = @id
  `).run({ ...payload, id });

  res.json({ offer: shape(loadOffer(id), req) });
}));

// ── Admin: send it. This is what puts the link in the candidate's hands ──────
offersRouter.post('/:id/send', requireAdmin, wrap(async (req, res) => {
  const id = v.int(req.params.id, 'Offer id', { min: 1 });
  const offer = loadOffer(id);
  if (!offer) throw notFound('That offer does not exist.');
  if (['accepted', 'declined'].includes(offer.status)) {
    throw conflict('The candidate has already responded to this offer.');
  }

  const app = loadApplication(offer.application_id);
  const link = offerUrl(offer.token, req);

  db.prepare("UPDATE offers SET status = 'sent', sent_at = COALESCE(sent_at, datetime('now')), updated_at = datetime('now') WHERE id = ?").run(id);
  db.prepare("UPDATE applications SET stage = 'offer_sent', updated_at = datetime('now') WHERE id = ?").run(app.id);

  const fresh = loadOffer(id);
  const mail = renderOfferEmail({
    offer: fresh,
    application: app,
    candidate: { full_name: app.candidate_name, email: app.candidate_email },
    job: { title: app.job_title },
    link,
  });
  const delivery = await (await import('../lib/mailer.js')).sendMail({
    to: app.candidate_email, toName: app.candidate_name,
    subject: mail.subject, html: mail.html, text: mail.text,
    kind: 'offer.sent', relatedId: id,
  });

  logActivity({
    actorId: req.user.id, actorName: req.user.fullName, action: 'offer.sent',
    entity: 'offer', entityId: id, detail: `${app.candidate_name} · ${fresh.position_title}`,
  });

  res.json({ offer: shape(fresh, req), link, emailDelivered: delivery.delivered });
}));

offersRouter.post('/:id/revoke', requireAdmin, wrap((req, res) => {
  const id = v.int(req.params.id, 'Offer id', { min: 1 });
  const offer = loadOffer(id);
  if (!offer) throw notFound('That offer does not exist.');
  if (offer.status === 'accepted') throw conflict('You cannot revoke an offer the candidate already accepted.');

  db.prepare("UPDATE offers SET status = 'revoked', updated_at = datetime('now') WHERE id = ?").run(id);
  db.prepare("UPDATE applications SET stage = 'approved', updated_at = datetime('now') WHERE id = ?").run(offer.application_id);
  logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'offer.revoked', entity: 'offer', entityId: id });
  res.json({ offer: shape(loadOffer(id), req) });
}));

// ── Public offer link. No login: the token is the credential ────────────────
export const publicOfferRouter = express.Router();

const publicPayload = (offer, app, req) => ({
  offer: {
    ...shape(offer, req),
    token: undefined,
    reference: `DAC/OFR/${new Date(offer.created_at).getFullYear()}/${String(app.id).padStart(4, '0')}`,
  },
  candidate: { fullName: app.candidate_name, email: app.candidate_email },
  job: { title: app.job_title, code: app.job_code },
  org: config.org,
  letterHtml: renderLetterBody({
    offer,
    application: app,
    candidate: { full_name: app.candidate_name },
    job: { title: app.job_title },
  }),
  expired: Boolean(offer.expires_on && new Date(`${offer.expires_on}T23:59:59Z`) < new Date()),
  expiresOnLabel: prettyDate(offer.expires_on),
});

publicOfferRouter.get('/:token', wrap((req, res) => {
  const offer = loadOfferByToken(String(req.params.token || ''));
  if (!offer) throw notFound('This offer link is not valid. Check the address, or ask the AI Cell office to resend it.');
  if (offer.status === 'draft') throw notFound('This offer has not been sent yet.');
  if (offer.status === 'revoked') throw conflict('This offer has been withdrawn. Please contact the AI Cell office.');

  const app = loadApplication(offer.application_id);
  res.json(publicPayload(offer, app, req));
}));

publicOfferRouter.post('/:token/respond', wrap(async (req, res) => {
  const offer = loadOfferByToken(String(req.params.token || ''));
  if (!offer) throw notFound('This offer link is not valid.');
  if (offer.status === 'revoked') throw conflict('This offer has been withdrawn.');
  if (offer.status === 'draft') throw notFound('This offer has not been sent yet.');
  if (['accepted', 'declined'].includes(offer.status)) {
    throw conflict(`You have already ${offer.status} this offer.`);
  }
  if (offer.expires_on && new Date(`${offer.expires_on}T23:59:59Z`) < new Date()) {
    throw conflict('This offer has expired. Please contact the AI Cell office.');
  }

  const decision = v.oneOf(req.body.decision, 'Decision', ['accept', 'decline']);
  const reason = v.str(req.body.reason, 'Reason', { required: false, max: 1000 });
  const accepted = decision === 'accept';
  const app = loadApplication(offer.application_id);

  db.prepare(`
    UPDATE offers SET status = ?, accepted_at = ?, declined_at = ?, decline_reason = ?, updated_at = datetime('now')
     WHERE id = ?
  `).run(
    accepted ? 'accepted' : 'declined',
    accepted ? new Date().toISOString() : null,
    accepted ? null : new Date().toISOString(),
    accepted ? null : reason,
    offer.id,
  );
  db.prepare("UPDATE applications SET stage = ?, updated_at = datetime('now') WHERE id = ?")
    .run(accepted ? 'offer_accepted' : 'offer_declined', app.id);

  logActivity({
    actorId: app.candidate_id, actorName: app.candidate_name,
    action: accepted ? 'offer.accepted' : 'offer.declined',
    entity: 'offer', entityId: offer.id, detail: reason || null,
  });

  const admins = db.prepare("SELECT full_name, email FROM users WHERE role = 'admin' AND status = 'active'").all();
  await notify.notifyOfferResponded({
    admins, candidate: { full_name: app.candidate_name },
    job: { title: app.job_title }, offer, accepted, reason,
  });

  res.json({ ok: true, status: accepted ? 'accepted' : 'declined' });
}));
