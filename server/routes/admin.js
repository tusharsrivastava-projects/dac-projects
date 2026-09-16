import express from 'express';
import { db } from '../db/index.js';
import { smtpConfigured } from '../lib/mailer.js';
import { STAGES } from '../lib/stages.js';
import { wrap } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireAdmin } from '../middleware/session.js';

export const adminRouter = express.Router();
adminRouter.use(requireAdmin);

adminRouter.get('/overview', wrap((_req, res) => {
  const stageCounts = Object.fromEntries(
    db.prepare('SELECT stage, COUNT(*) AS n FROM applications GROUP BY stage').all().map((r) => [r.stage, r.n]),
  );
  const totals = {
    applications: db.prepare('SELECT COUNT(*) AS n FROM applications').get().n,
    candidates: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'candidate'").get().n,
    openRoles: db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'open'").get().n,
    questions: db.prepare('SELECT COUNT(*) AS n FROM questions WHERE active = 1').get().n,
    awaitingReview: (stageCounts.evaluation ?? 0) + (stageCounts.applied ?? 0) + (stageCounts.screening ?? 0),
    offersOut: db.prepare("SELECT COUNT(*) AS n FROM offers WHERE status = 'sent'").get().n,
    offersAccepted: db.prepare("SELECT COUNT(*) AS n FROM offers WHERE status = 'accepted'").get().n,
    recordings: db.prepare('SELECT COUNT(*) AS n FROM answers').get().n,
    unscored: db.prepare('SELECT COUNT(*) AS n FROM answers WHERE score IS NULL').get().n,
  };

  const pipeline = Object.entries(STAGES).map(([key, meta]) => ({
    stage: key, label: meta.label, tone: meta.tone, count: stageCounts[key] ?? 0,
  }));

  const perRole = db.prepare(`
    SELECT j.id, j.title, j.status, j.openings,
           COUNT(a.id) AS applications,
           SUM(CASE WHEN a.stage IN ('offer_sent','offer_accepted') THEN 1 ELSE 0 END) AS offers,
           ROUND(AVG(a.score), 2) AS avg_score
      FROM jobs j LEFT JOIN applications a ON a.job_id = j.id
     GROUP BY j.id ORDER BY applications DESC, j.title
  `).all();

  const recent = db.prepare(`
    SELECT action, actor_name, entity, entity_id, detail, created_at
      FROM activity_log ORDER BY id DESC LIMIT 15
  `).all();

  res.json({ totals, pipeline, perRole, recent, smtpConfigured: smtpConfigured() });
}));

adminRouter.get('/outbox', wrap((req, res) => {
  const limit = v.int(req.query.limit, 'Limit', { min: 1, max: 200, fallback: 40 });
  const rows = db.prepare(`
    SELECT id, to_email, to_name, subject, kind, status, provider, error, created_at, sent_at
      FROM mail_outbox ORDER BY id DESC LIMIT ?
  `).all(limit);
  res.json({ messages: rows, smtpConfigured: smtpConfigured() });
}));

adminRouter.get('/outbox/:id', wrap((req, res) => {
  const id = v.int(req.params.id, 'Message id', { min: 1 });
  const row = db.prepare('SELECT * FROM mail_outbox WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'No such message.' });
  res.json({ message: row });
}));

adminRouter.get('/candidates', wrap((req, res) => {
  const q = req.query.q ? `%${String(req.query.q).toLowerCase().trim()}%` : null;
  const rows = db.prepare(`
    SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
           COUNT(a.id) AS applications,
           MAX(a.created_at) AS last_applied
      FROM users u LEFT JOIN applications a ON a.candidate_id = u.id
     WHERE u.role = 'candidate' ${q ? 'AND (lower(u.full_name) LIKE @q OR lower(u.email) LIKE @q)' : ''}
     GROUP BY u.id ORDER BY u.created_at DESC LIMIT 200
  `).all(q ? { q } : {});
  res.json({ candidates: rows });
}));

adminRouter.get('/activity', wrap((req, res) => {
  const limit = v.int(req.query.limit, 'Limit', { min: 1, max: 300, fallback: 80 });
  res.json({
    activity: db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?').all(limit),
  });
}));
