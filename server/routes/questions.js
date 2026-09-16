import express from 'express';
import { db, logActivity } from '../db/index.js';
import { conflict, notFound, wrap } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireAdmin } from '../middleware/session.js';

export const questionsRouter = express.Router();

const shape = (q) => ({
  id: q.id,
  jobId: q.job_id,
  jobTitle: q.job_title ?? null,
  prompt: q.prompt,
  hint: q.hint,
  thinkSeconds: q.think_seconds,
  answerSeconds: q.answer_seconds,
  position: q.position,
  active: Boolean(q.active),
  answerCount: q.answer_count ?? 0,
  createdAt: q.created_at,
});

/** The question bank an admin edits. jobId=null rows are asked for every role. */
questionsRouter.get('/', requireAdmin, wrap((req, res) => {
  const where = [];
  const params = {};
  if (req.query.jobId === 'general') {
    where.push('q.job_id IS NULL');
  } else if (req.query.jobId && req.query.jobId !== 'all') {
    params.jobId = v.int(req.query.jobId, 'Role', { min: 1 });
    where.push('(q.job_id = @jobId OR q.job_id IS NULL)');
  }
  if (req.query.active === '1') where.push('q.active = 1');

  const rows = db.prepare(`
    SELECT q.*, j.title AS job_title,
           (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id) AS answer_count
      FROM questions q
      LEFT JOIN jobs j ON j.id = q.job_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY q.job_id IS NULL DESC, q.position, q.id
  `).all(params);

  res.json({ questions: rows.map(shape) });
}));

const readBody = (body, existing = {}) => {
  const jobIdRaw = body.jobId ?? existing.job_id;
  const jobId = jobIdRaw === null || jobIdRaw === '' || jobIdRaw === 'general' || jobIdRaw === undefined
    ? null
    : v.int(jobIdRaw, 'Role', { min: 1 });
  if (jobId !== null && !db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(jobId)) {
    throw notFound('That role does not exist.');
  }
  return {
    job_id: jobId,
    prompt: v.str(body.prompt ?? existing.prompt, 'Question', { min: 10, max: 1000 }),
    hint: v.str(body.hint ?? existing.hint, 'Hint', { required: false, max: 400 }),
    think_seconds: v.int(body.thinkSeconds ?? existing.think_seconds, 'Thinking time', { min: 0, max: 300, fallback: 30 }),
    answer_seconds: v.int(body.answerSeconds ?? existing.answer_seconds, 'Answer time', { min: 15, max: 900, fallback: 120 }),
    position: v.int(body.position ?? existing.position, 'Order', { min: 0, max: 999, fallback: 0 }),
    active: (body.active ?? existing.active ?? true) ? 1 : 0,
  };
};

questionsRouter.post('/', requireAdmin, wrap((req, res) => {
  const q = readBody(req.body);
  if (!q.position) {
    const max = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM questions WHERE job_id IS ?').get(q.job_id).m;
    q.position = max + 1;
  }
  const id = db.prepare(`
    INSERT INTO questions (job_id, prompt, hint, think_seconds, answer_seconds, position, active, created_by)
    VALUES (@job_id, @prompt, @hint, @think_seconds, @answer_seconds, @position, @active, @created_by)
  `).run({ ...q, created_by: req.user.id }).lastInsertRowid;

  logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'question.created', entity: 'question', entityId: id, detail: q.prompt.slice(0, 120) });
  res.status(201).json({ question: shape(db.prepare('SELECT * FROM questions WHERE id = ?').get(id)) });
}));

questionsRouter.patch('/:id', requireAdmin, wrap((req, res) => {
  const id = v.int(req.params.id, 'Question id', { min: 1 });
  const existing = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  if (!existing) throw notFound('That question does not exist.');

  const q = readBody(req.body, existing);
  db.prepare(`
    UPDATE questions SET job_id = @job_id, prompt = @prompt, hint = @hint,
           think_seconds = @think_seconds, answer_seconds = @answer_seconds,
           position = @position, active = @active
     WHERE id = @id
  `).run({ ...q, id });

  logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'question.updated', entity: 'question', entityId: id });
  res.json({ question: shape(db.prepare('SELECT * FROM questions WHERE id = ?').get(id)) });
}));

questionsRouter.delete('/:id', requireAdmin, wrap((req, res) => {
  const id = v.int(req.params.id, 'Question id', { min: 1 });
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  if (!q) throw notFound('That question does not exist.');

  const answers = db.prepare('SELECT COUNT(*) AS n FROM answers WHERE question_id = ?').get(id).n;
  if (answers > 0) {
    // Deleting would take candidates' recordings with it. Retire it instead.
    db.prepare('UPDATE questions SET active = 0 WHERE id = ?').run(id);
    logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'question.retired', entity: 'question', entityId: id });
    return res.json({ ok: true, retired: true, message: `${answers} recorded answer(s) use this question, so it was retired instead of deleted.` });
  }

  db.prepare('DELETE FROM questions WHERE id = ?').run(id);
  logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'question.deleted', entity: 'question', entityId: id });
  res.json({ ok: true, retired: false });
}));

questionsRouter.post('/reorder', requireAdmin, wrap((req, res) => {
  const order = Array.isArray(req.body.order) ? req.body.order : null;
  if (!order?.length) throw conflict('Send an ordered array of question ids.');
  const update = db.prepare('UPDATE questions SET position = ? WHERE id = ?');
  db.transaction(() => {
    order.forEach((qid, i) => update.run(i + 1, v.int(qid, 'Question id', { min: 1 })));
  })();
  res.json({ ok: true });
}));
