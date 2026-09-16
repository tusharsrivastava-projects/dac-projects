import express from 'express';
import { db, logActivity } from '../db/index.js';
import { notFound, wrap } from '../lib/http.js';
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
  createdAt: j.created_at,
  applicationCount: j.application_count ?? undefined,
  questionCount: j.question_count ?? undefined,
  myApplication: j.my_application_id
    ? { id: j.my_application_id, stage: j.my_stage }
    : null,
});

/** Open roles, with the caller's own application attached when signed in. */
jobsRouter.get('/', wrap((req, res) => {
  const all = req.user?.role === 'admin' && req.query.all === '1';
  const rows = db.prepare(`
    SELECT j.*,
           (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS application_count,
           (SELECT COUNT(*) FROM questions q WHERE q.active = 1 AND (q.job_id = j.id OR q.job_id IS NULL)) AS question_count,
           ma.id    AS my_application_id,
           ma.stage AS my_stage
      FROM jobs j
      LEFT JOIN applications ma ON ma.job_id = j.id AND ma.candidate_id = ?
     ${all ? '' : "WHERE j.status = 'open'"}
     ORDER BY j.status = 'open' DESC, j.created_at DESC
  `).all(req.user?.id ?? -1);
  res.json({ jobs: rows.map(shape) });
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
  if (job.status !== 'open' && req.user?.role !== 'admin') throw notFound('That role is no longer open.');
  res.json({ job: shape(job) });
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
});

jobsRouter.post('/', requireAdmin, wrap((req, res) => {
  const j = readJobBody(req.body);
  const id = db.prepare(`
    INSERT INTO jobs (code, title, department, location, employment_type, stipend, summary, description, openings, status, created_by)
    VALUES (@code, @title, @department, @location, @employment_type, @stipend, @summary, @description, @openings, @status, @created_by)
  `).run({ ...j, code: jobCode(j.title), created_by: req.user.id }).lastInsertRowid;

  logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'job.created', entity: 'job', entityId: id, detail: j.title });
  res.status(201).json({ job: shape(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)) });
}));

jobsRouter.patch('/:id', requireAdmin, wrap((req, res) => {
  const id = v.int(req.params.id, 'Job id', { min: 1 });
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!existing) throw notFound('That role does not exist.');

  const j = readJobBody({ ...shape(existing), ...req.body });
  db.prepare(`
    UPDATE jobs SET title = @title, department = @department, location = @location,
           employment_type = @employment_type, stipend = @stipend, summary = @summary,
           description = @description, openings = @openings, status = @status,
           updated_at = datetime('now')
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
    // Never destroy applications as a side effect of tidying up the board.
    db.prepare("UPDATE jobs SET status = 'closed', updated_at = datetime('now') WHERE id = ?").run(id);
    logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'job.closed', entity: 'job', entityId: id, detail: job.title });
    return res.json({ ok: true, closed: true, message: `${count} application(s) reference this role, so it was closed instead of deleted.` });
  }

  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'job.deleted', entity: 'job', entityId: id, detail: job.title });
  res.json({ ok: true, closed: false });
}));
