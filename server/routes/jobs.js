import express from 'express';
import { db, logActivity } from '../db/index.js';
import { conflict, notFound, wrap } from '../lib/http.js';
import { jobCode } from '../lib/ids.js';
import * as v from '../lib/validate.js';
import { requireAdmin } from '../middleware/session.js';

export const jobsRouter = express.Router();

const shape = (j) => ({
  id: j.id,
  code: j.code,
  title: j.title,
  department: j.department,
  location: j.location,
  employmentType: j.employment_type,
  stipend: j.stipend,
  summary: j.summary,
  description: j.description,
  openings: j.openings,
  status: j.status,
  interviewMode: j.interview_mode || 'at_application',
  archived: Boolean(j.archived_at),
  archivedAt: j.archived_at ?? null,
  createdAt: j.created_at,
  applicationCount: j.application_count ?? undefined,
  questionCount: j.question_count ?? undefined,
  myApplication: j.my_application_id
    ? { id: j.my_application_id, stage: j.my_stage }
    : null,
});

/** Open roles, with the caller's own application attached when signed in. */
jobsRouter.get('/', wrap((req, res) => {
  const isAdmin = req.user?.role === 'admin';
  const all = isAdmin && req.query.all === '1';
  // Archived roles stay out of the roles section. An admin can ask for them
  // back with ?archived=1; a candidate never sees them at all.
  const withArchived = isAdmin && req.query.archived === '1';
  const rows = db.prepare(`
    SELECT j.*,
           (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS application_count,
           (SELECT COUNT(*) FROM questions q WHERE q.active = 1 AND (q.job_id = j.id OR q.job_id IS NULL)) AS question_count,
           ma.id    AS my_application_id,
           ma.stage AS my_stage
      FROM jobs j
      LEFT JOIN applications ma ON ma.job_id = j.id AND ma.candidate_id = ?
     ${all
       ? (withArchived ? '' : 'WHERE j.archived_at IS NULL')
       : "WHERE j.status = 'open' AND j.archived_at IS NULL"}
     ORDER BY j.archived_at IS NOT NULL, j.status = 'open' DESC, j.created_at DESC
  `).all(req.user?.id ?? -1);

  const archivedCount = isAdmin
    ? db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE archived_at IS NOT NULL').get().n
    : undefined;

  res.json({ jobs: rows.map(shape), archivedCount });
}));

jobsRouter.get('/:id', wrap((req, res) => {
  const id = v.int(req.params.id, 'Job id', { min: 1 });
  const job = db.prepare(`
    SELECT j.*,
           (SELECT COUNT(*) FROM questions q WHERE q.active = 1 AND (q.job_id = j.id OR q.job_id IS NULL)) AS question_count,
           ma.id AS my_application_id, ma.stage AS my_stage
      FROM jobs j
      LEFT JOIN applications ma ON ma.job_id = j.id AND ma.candidate_id = ?
     WHERE j.id = ?
  `).get(req.user?.id ?? -1, id);
  if (!job) throw notFound('That role does not exist.');
  if (req.user?.role !== 'admin' && (job.status !== 'open' || job.archived_at)) {
    throw notFound('That role is no longer open.');
  }
  res.json({ job: shape(job) });
}));

/**
 * The questions a candidate will be asked for this role. Visible before they
 * apply: knowing what is coming is the difference between a considered answer
 * and a panicked one, and it costs the panel nothing.
 */
jobsRouter.get('/:id/questions', wrap((req, res) => {
  const id = v.int(req.params.id, 'Job id', { min: 1 });
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!job) throw notFound('That role does not exist.');
  if (req.user?.role !== 'admin' && (job.status !== 'open' || job.archived_at)) {
    throw notFound('That role is no longer open.');
  }

  const rows = db.prepare(`
    SELECT id, prompt, hint, think_seconds, answer_seconds, job_id
      FROM questions
     WHERE active = 1 AND (job_id IS NULL OR job_id = ?)
     ORDER BY job_id IS NULL DESC, position, id
  `).all(id);

  res.json({
    jobId: id,
    interviewMode: job.interview_mode || 'at_application',
    totalSeconds: rows.reduce((n, q) => n + q.think_seconds + q.answer_seconds, 0),
    questions: rows.map((q, i) => ({
      number: i + 1,
      prompt: q.prompt,
      hint: q.hint,
      thinkSeconds: q.think_seconds,
      answerSeconds: q.answer_seconds,
      scope: q.job_id ? 'role' : 'general',
    })),
  });
}));

const readJobBody = (body) => ({
  title: v.str(body.title, 'Title', { min: 3, max: 140 }),
  department: v.str(body.department, 'Team', { required: false, max: 120 }) || 'DGU AI Cell',
  location: v.str(body.location, 'Location', { required: false, max: 140 }) || 'Dehradun, IN',
  employment_type: v.oneOf(body.employmentType || 'Internship', 'Engagement type',
    ['Internship', 'Full-time', 'Part-time', 'Contract', 'Research Fellowship']),
  stipend: v.str(body.stipend, 'Compensation', { required: false, max: 120 }),
  summary: v.str(body.summary, 'Summary', { required: false, max: 400 }),
  description: v.str(body.description, 'Description', { required: false, max: 12000 }),
  openings: v.int(body.openings, 'Openings', { min: 1, max: 500, fallback: 1 }),
  status: v.oneOf(body.status || 'open', 'Status', ['draft', 'open', 'closed']),
  interview_mode: v.oneOf(body.interviewMode || 'at_application', 'Interview timing',
    ['at_application', 'after_screening']),
});

jobsRouter.post('/', requireAdmin, wrap((req, res) => {
  const j = readJobBody(req.body);
  const id = db.prepare(`
    INSERT INTO jobs (code, title, department, location, employment_type, stipend, summary, description,
                      openings, status, interview_mode, created_by)
    VALUES (@code, @title, @department, @location, @employment_type, @stipend, @summary, @description,
            @openings, @status, @interview_mode, @created_by)
  `).run({ ...j, code: jobCode(j.title), created_by: req.user.id }).lastInsertRowid;

  logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'job.created', entity: 'job', entityId: id, detail: j.title });
  res.status(201).json({ job: shape(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)) });
}));

jobsRouter.patch('/:id', requireAdmin, wrap((req, res) => {
  const id = v.int(req.params.id, 'Job id', { min: 1 });
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!existing) throw notFound('That role does not exist.');

  const j = readJobBody({ ...shape(existing), ...req.body });
  // Saving an archived role is a clear signal it is wanted again.
  if (existing.archived_at) db.prepare('UPDATE jobs SET archived_at = NULL WHERE id = ?').run(id);

  db.prepare(`
    UPDATE jobs SET title = @title, department = @department, location = @location,
           employment_type = @employment_type, stipend = @stipend, summary = @summary,
           description = @description, openings = @openings, status = @status,
           interview_mode = @interview_mode, updated_at = datetime('now')
     WHERE id = @id
  `).run({ ...j, id });

  logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'job.updated', entity: 'job', entityId: id, detail: j.title });
  res.json({ job: shape(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)) });
}));

jobsRouter.delete('/:id', requireAdmin, wrap((req, res) => {
  const id = v.int(req.params.id, 'Job id', { min: 1 });
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!job) throw notFound('That role does not exist.');

  const count = db.prepare('SELECT COUNT(*) AS n FROM applications WHERE job_id = ?').get(id).n;
  if (count > 0) {
    // Deleting would take every application and recording with it. Archive
    // instead: off the roles section, out of sight for candidates, and the
    // applications stay reviewable.
    db.prepare(`
      UPDATE jobs SET status = 'closed', archived_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?
    `).run(id);
    logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'job.archived', entity: 'job', entityId: id, detail: job.title });
    return res.json({
      ok: true, archived: true, applications: count,
      message: `Archived. ${count} application${count === 1 ? '' : 's'} still reference this role, so it was taken off the board rather than deleted — you can still review them, and restore the role at any time.`,
    });
  }

  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'job.deleted', entity: 'job', entityId: id, detail: job.title });
  res.json({ ok: true, archived: false, message: `${job.title} deleted.` });
}));

/** Puts an archived role back on the board, closed rather than open. */
jobsRouter.post('/:id/restore', requireAdmin, wrap((req, res) => {
  const id = v.int(req.params.id, 'Job id', { min: 1 });
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!job) throw notFound('That role does not exist.');
  if (!job.archived_at) throw conflict('That role is not archived.');

  db.prepare("UPDATE jobs SET archived_at = NULL, updated_at = datetime('now') WHERE id = ?").run(id);
  logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'job.restored', entity: 'job', entityId: id, detail: job.title });
  res.json({ job: shape(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)) });
}));
