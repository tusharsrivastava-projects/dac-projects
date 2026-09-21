import express from 'express';
import { db, logActivity } from '../db/index.js';
import { badRequest, conflict, forbidden, notFound, wrap } from '../lib/http.js';
import * as notify from '../lib/notify.js';
import { STAGES, TERMINAL, adminMovesFrom, assertAdminMove } from '../lib/stages.js';
import * as v from '../lib/validate.js';
import { requireAdmin, requireAuth } from '../middleware/session.js';

export const applicationsRouter = express.Router();

const dashLink = (req) => {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${req.get('host')}/app`;
};

export const shapeApplication = (a) => ({
  id: a.id,
  stage: a.stage,
  stageLabel: STAGES[a.stage]?.label ?? a.stage,
  stageTone: STAGES[a.stage]?.tone ?? 'neutral',
  stageBlurb: STAGES[a.stage]?.blurb ?? '',
  headline: a.headline,
  experience: a.experience,
  skills: a.skills,
  portfolioUrl: a.portfolio_url,
  resumeUrl: a.resume_url,
  coverNote: a.cover_note,
  score: a.score,
  adminNotes: a.admin_notes,
  rejectReason: a.reject_reason,
  reviewedBy: a.reviewer_name ?? null,
  reviewedAt: a.reviewed_at,
  interviewUnlockedAt: a.interview_unlocked_at,
  interviewSubmittedAt: a.interview_submitted_at,
  driveFolderLink: a.drive_folder_link || null,
  createdAt: a.created_at,
  updatedAt: a.updated_at,
  candidate: { id: a.candidate_id, fullName: a.candidate_name, email: a.candidate_email, phone: a.candidate_phone },
  job: { id: a.job_id, title: a.job_title, code: a.job_code, employmentType: a.job_type, department: a.job_dept },
  answered: a.answered ?? 0,
  questionTotal: a.question_total ?? 0,
  evaluatedCount: a.evaluated_count ?? 0,
  offer: a.offer_id ? { id: a.offer_id, status: a.offer_status, token: a.offer_token } : null,
  nextStages: adminMovesFrom(a.stage),
});

const BASE_SELECT = `
  SELECT a.*,
         u.full_name AS candidate_name, u.email AS candidate_email, u.phone AS candidate_phone,
         j.title AS job_title, j.code AS job_code, j.employment_type AS job_type, j.department AS job_dept,
         r.full_name AS reviewer_name,
         o.id AS offer_id, o.status AS offer_status, o.token AS offer_token,
         (SELECT COUNT(*) FROM answers an WHERE an.application_id = a.id) AS answered,
         (SELECT COUNT(*) FROM answers an WHERE an.application_id = a.id AND an.score IS NOT NULL) AS evaluated_count,
         (SELECT COUNT(*) FROM questions q
           WHERE q.active = 1 AND (q.job_id = a.job_id OR q.job_id IS NULL)) AS question_total
    FROM applications a
    JOIN users u ON u.id = a.candidate_id
    JOIN jobs  j ON j.id = a.job_id
    LEFT JOIN users  r ON r.id = a.reviewed_by
    LEFT JOIN offers o ON o.application_id = a.id
`;

const loadApplication = (id) => db.prepare(`${BASE_SELECT} WHERE a.id = ?`).get(id);

/** Candidate may read their own; admin may read anything. */
function authorise(req, app) {
  if (!app) throw notFound('That application does not exist.');
  if (req.user.role === 'admin') return app;
  if (app.candidate_id !== req.user.id) throw forbidden('That application is not yours.');
  return app;
}

// ── Candidate: apply ─────────────────────────────────────────────────────────
applicationsRouter.post('/', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'candidate') throw forbidden('Admin accounts cannot apply to roles.');

  const jobId = v.int(req.body.jobId, 'Role', { min: 1 });
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw notFound('That role does not exist.');
  if (job.status !== 'open') throw conflict('Applications for this role are closed.');

  if (db.prepare('SELECT 1 FROM applications WHERE candidate_id = ? AND job_id = ?').get(req.user.id, jobId)) {
    throw conflict('You have already applied to this role.');
  }

  const payload = {
    candidate_id: req.user.id,
    job_id: jobId,
    headline: v.str(req.body.headline, 'Headline', { min: 3, max: 160 }),
    experience: v.str(req.body.experience, 'Experience', { required: false, max: 3000 }),
    skills: v.str(req.body.skills, 'Skills', { required: false, max: 600 }),
    portfolio_url: v.url(req.body.portfolioUrl, 'Portfolio link'),
    resume_url: v.url(req.body.resumeUrl, 'Résumé link'),
    cover_note: v.str(req.body.coverNote, 'Why this role', { min: 20, max: 4000 }),
  };

  const id = db.prepare(`
    INSERT INTO applications (candidate_id, job_id, headline, experience, skills, portfolio_url, resume_url, cover_note)
    VALUES (@candidate_id, @job_id, @headline, @experience, @skills, @portfolio_url, @resume_url, @cover_note)
  `).run(payload).lastInsertRowid;

  logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'application.submitted', entity: 'application', entityId: id, detail: job.title });

  const app = loadApplication(id);
  await notify.notifyApplicationReceived({
    candidate: { email: app.candidate_email, full_name: app.candidate_name },
    job, application: app, link: dashLink(req),
  });

  res.status(201).json({ application: shapeApplication(app) });
}));

// ── Candidate: my applications ───────────────────────────────────────────────
applicationsRouter.get('/mine', requireAuth, wrap((req, res) => {
  const rows = db.prepare(`${BASE_SELECT} WHERE a.candidate_id = ? ORDER BY a.created_at DESC`).all(req.user.id);
  res.json({ applications: rows.map(shapeApplication) });
}));

// ── Admin: review every application ──────────────────────────────────────────
applicationsRouter.get('/', requireAdmin, wrap((req, res) => {
  const where = [];
  const params = {};

  if (req.query.stage && req.query.stage !== 'all') {
    const stages = String(req.query.stage).split(',').filter((s) => s in STAGES);
    if (!stages.length) throw badRequest('Unknown stage filter.');
    where.push(`a.stage IN (${stages.map((_, i) => `@stage${i}`).join(', ')})`);
    stages.forEach((s, i) => { params[`stage${i}`] = s; });
  }
  if (req.query.jobId && req.query.jobId !== 'all') {
    params.jobId = v.int(req.query.jobId, 'Role', { min: 1 });
    where.push('a.job_id = @jobId');
  }
  if (req.query.q) {
    params.q = `%${String(req.query.q).trim().toLowerCase()}%`;
    where.push(`(lower(u.full_name) LIKE @q OR lower(u.email) LIKE @q OR lower(j.title) LIKE @q OR lower(COALESCE(a.headline,'')) LIKE @q)`);
  }

  const sortMap = {
    newest: 'a.created_at DESC',
    oldest: 'a.created_at ASC',
    score: 'a.score DESC NULLS LAST, a.created_at DESC',
    name: 'u.full_name COLLATE NOCASE ASC',
  };
  const order = sortMap[req.query.sort] || sortMap.newest;
  const limit = v.int(req.query.limit, 'Limit', { min: 1, max: 200, fallback: 50 });
  const offset = v.int(req.query.offset, 'Offset', { min: 0, max: 1e6, fallback: 0 });

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`${BASE_SELECT} ${clause} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });

  const total = db.prepare(`
    SELECT COUNT(*) AS n FROM applications a
    JOIN users u ON u.id = a.candidate_id JOIN jobs j ON j.id = a.job_id ${clause}
  `).get(params).n;

  const counts = Object.fromEntries(
    db.prepare('SELECT stage, COUNT(*) AS n FROM applications GROUP BY stage').all().map((r) => [r.stage, r.n]),
  );

  res.json({ applications: rows.map(shapeApplication), total, limit, offset, counts });
}));

// ── Either role: one application ─────────────────────────────────────────────
applicationsRouter.get('/:id', requireAuth, wrap((req, res) => {
  const id = v.int(req.params.id, 'Application id', { min: 1 });
  const app = authorise(req, loadApplication(id));

  const answers = db.prepare(`
    SELECT an.*, q.prompt, q.hint, q.position, e.full_name AS evaluator_name
      FROM answers an
      JOIN questions q ON q.id = an.question_id
      LEFT JOIN users e ON e.id = an.evaluated_by
     WHERE an.application_id = ?
     ORDER BY q.position, q.id
  `).all(id);

  res.json({
    application: shapeApplication(app),
    answers: answers.map((a) => ({
      id: a.id,
      questionId: a.question_id,
      prompt: a.prompt,
      hint: a.hint,
      audioUrl: `/api/interview/audio/${a.id}`,
      mimeType: a.mime_type,
      durationSeconds: a.duration_seconds,
      sizeBytes: a.size_bytes,
      storage: a.storage || 'local',
      driveLink: a.drive_link || null,
      transcript: a.transcript,
      score: a.score,
      feedback: a.feedback,
      evaluatedBy: a.evaluator_name,
      evaluatedAt: a.evaluated_at,
      createdAt: a.created_at,
    })),
  });
}));

// ── Admin: move stage ────────────────────────────────────────────────────────
applicationsRouter.patch('/:id/stage', requireAdmin, wrap(async (req, res) => {
  const id = v.int(req.params.id, 'Application id', { min: 1 });
  const app = loadApplication(id);
  if (!app) throw notFound('That application does not exist.');

  const to = v.oneOf(req.body.stage, 'Stage', Object.keys(STAGES));
  assertAdminMove(app.stage, to);

  const reason = v.str(req.body.reason, 'Reason', { required: false, max: 1000 });
  if (to === 'rejected' && !reason) throw badRequest('Give the candidate a reason before rejecting.', { field: 'reason' });

  db.prepare(`
    UPDATE applications
       SET stage = ?, reject_reason = ?, reviewed_by = ?, reviewed_at = datetime('now'),
           interview_unlocked_at = CASE WHEN ? = 'interview' AND interview_unlocked_at IS NULL
                                       THEN datetime('now') ELSE interview_unlocked_at END,
           updated_at = datetime('now')
     WHERE id = ?
  `).run(to, to === 'rejected' ? reason : null, req.user.id, to, id);

  logActivity({
    actorId: req.user.id, actorName: req.user.fullName,
    action: `application.stage.${to}`, entity: 'application', entityId: id,
    detail: `${app.candidate_name} · ${app.job_title}${reason ? ` · ${reason}` : ''}`,
  });

  const candidate = { email: app.candidate_email, full_name: app.candidate_name };
  const job = { title: app.job_title };
  const link = dashLink(req);

  if (to === 'interview') await notify.notifyInterviewUnlocked({ candidate, job, application: app, link });
  if (to === 'approved') await notify.notifyApproved({ candidate, job, application: app, link });
  if (to === 'rejected') await notify.notifyRejected({ candidate, job, application: app, reason });

  res.json({ application: shapeApplication(loadApplication(id)) });
}));

// ── Admin: private notes ─────────────────────────────────────────────────────
applicationsRouter.patch('/:id/notes', requireAdmin, wrap((req, res) => {
  const id = v.int(req.params.id, 'Application id', { min: 1 });
  if (!loadApplication(id)) throw notFound('That application does not exist.');
  const notes = v.str(req.body.adminNotes, 'Notes', { required: false, max: 5000 });
  db.prepare("UPDATE applications SET admin_notes = ?, updated_at = datetime('now') WHERE id = ?").run(notes, id);
  res.json({ application: shapeApplication(loadApplication(id)) });
}));

// ── Candidate: withdraw ──────────────────────────────────────────────────────
applicationsRouter.post('/:id/withdraw', requireAuth, wrap((req, res) => {
  const id = v.int(req.params.id, 'Application id', { min: 1 });
  const app = authorise(req, loadApplication(id));
  if (req.user.role !== 'candidate') throw forbidden('Only the candidate can withdraw an application.');
  if (TERMINAL.has(app.stage)) throw conflict('This application is already closed.');

  db.prepare("UPDATE applications SET stage = 'withdrawn', updated_at = datetime('now') WHERE id = ?").run(id);
  logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'application.withdrawn', entity: 'application', entityId: id, detail: app.job_title });
  res.json({ application: shapeApplication(loadApplication(id)) });
}));

export { loadApplication, BASE_SELECT };
