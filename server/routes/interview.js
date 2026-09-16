import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { db, logActivity } from '../db/index.js';
import { badRequest, conflict, forbidden, notFound, wrap } from '../lib/http.js';
import * as notify from '../lib/notify.js';
import { INTERVIEW_OPEN } from '../lib/stages.js';
import * as v from '../lib/validate.js';
import { requireAdmin, requireAuth } from '../middleware/session.js';
import { loadApplication, shapeApplication } from './applications.js';

export const interviewRouter = express.Router();

const EXT_BY_MIME = {
  'audio/webm': '.webm', 'video/webm': '.webm', 'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac',
  'audio/wav': '.wav', 'audio/x-wav': '.wav',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadDir),
    filename: (_req, file, cb) => {
      const base = String(file.mimetype || '').split(';')[0];
      cb(null, `ans_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${EXT_BY_MIME[base] || '.bin'}`);
    },
  }),
  limits: { fileSize: config.maxAudioBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const base = String(file.mimetype || '').split(';')[0];
    if (!config.allowedAudioTypes.includes(base)) {
      return cb(badRequest(`Unsupported audio format "${base}". Record in the browser or upload webm, ogg, mp3, m4a or wav.`));
    }
    cb(null, true);
  },
});

/** Active questions for a role: the general set plus anything role-specific. */
const questionsForJob = (jobId) => db.prepare(`
  SELECT * FROM questions
   WHERE active = 1 AND (job_id IS NULL OR job_id = ?)
   ORDER BY job_id IS NULL DESC, position, id
`).all(jobId);

function ownApplication(req, id) {
  const app = loadApplication(id);
  if (!app) throw notFound('That application does not exist.');
  if (req.user.role !== 'admin' && app.candidate_id !== req.user.id) {
    throw forbidden('That application is not yours.');
  }
  return app;
}

// ── The interview screen: questions the admin fed, plus anything already recorded
interviewRouter.get('/:applicationId', requireAuth, wrap((req, res) => {
  const id = v.int(req.params.applicationId, 'Application id', { min: 1 });
  const app = ownApplication(req, id);

  const questions = questionsForJob(app.job_id);
  const answers = db.prepare('SELECT * FROM answers WHERE application_id = ?').all(id);
  const byQuestion = new Map(answers.map((a) => [a.question_id, a]));

  res.json({
    application: shapeApplication(app),
    open: INTERVIEW_OPEN.has(app.stage),
    submittedAt: app.interview_submitted_at,
    questions: questions.map((q, i) => {
      const a = byQuestion.get(q.id);
      return {
        id: q.id,
        number: i + 1,
        prompt: q.prompt,
        hint: q.hint,
        thinkSeconds: q.think_seconds,
        answerSeconds: q.answer_seconds,
        scope: q.job_id ? 'role' : 'general',
        answer: a ? {
          id: a.id,
          audioUrl: `/api/interview/audio/${a.id}`,
          mimeType: a.mime_type,
          durationSeconds: a.duration_seconds,
          sizeBytes: a.size_bytes,
          recordedAt: a.created_at,
          score: a.score,
          feedback: a.feedback,
        } : null,
      };
    }),
  });
}));

// ── Candidate uploads one recorded answer ────────────────────────────────────
interviewRouter.post(
  '/:applicationId/answers/:questionId',
  requireAuth,
  upload.single('audio'),
  wrap((req, res) => {
    const cleanup = () => { if (req.file) fs.rmSync(req.file.path, { force: true }); };
    try {
      const appId = v.int(req.params.applicationId, 'Application id', { min: 1 });
      const questionId = v.int(req.params.questionId, 'Question id', { min: 1 });
      const app = ownApplication(req, appId);

      if (req.user.role !== 'candidate') throw forbidden('Only the candidate can record an answer.');
      if (!INTERVIEW_OPEN.has(app.stage)) throw conflict('Your interview is not open right now.');
      if (app.interview_submitted_at) throw conflict('You have already submitted this interview.');
      if (!req.file) throw badRequest('No audio came through. Record an answer and try again.');

      const question = db.prepare('SELECT * FROM questions WHERE id = ? AND active = 1').get(questionId);
      if (!question) throw notFound('That question is not part of this interview.');
      if (question.job_id !== null && question.job_id !== app.job_id) {
        throw badRequest('That question belongs to a different role.');
      }

      const duration = v.num(req.body.durationSeconds, 'Duration', { min: 0, max: 3600, fallback: null });
      const allowance = question.answer_seconds + 15; // a little slack for encoder tail
      if (duration && duration > allowance) {
        throw badRequest(`That answer runs ${Math.round(duration)}s but the limit is ${question.answer_seconds}s.`);
      }

      // Re-recording replaces the previous take; drop the old file so uploads stay tidy.
      const previous = db.prepare('SELECT * FROM answers WHERE application_id = ? AND question_id = ?').get(appId, questionId);
      if (previous) {
        fs.rmSync(path.join(config.uploadDir, previous.audio_file), { force: true });
        db.prepare('DELETE FROM answers WHERE id = ?').run(previous.id);
      }

      const id = db.prepare(`
        INSERT INTO answers (application_id, question_id, audio_file, mime_type, size_bytes, duration_seconds)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(appId, questionId, req.file.filename, String(req.file.mimetype || '').split(';')[0], req.file.size, duration).lastInsertRowid;

      logActivity({
        actorId: req.user.id, actorName: req.user.fullName,
        action: previous ? 'answer.rerecorded' : 'answer.recorded',
        entity: 'answer', entityId: id, detail: `application ${appId}, question ${questionId}`,
      });

      const answered = db.prepare('SELECT COUNT(*) AS n FROM answers WHERE application_id = ?').get(appId).n;
      res.status(201).json({
        answer: {
          id,
          questionId,
          audioUrl: `/api/interview/audio/${id}`,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          durationSeconds: duration,
        },
        answered,
        total: questionsForJob(app.job_id).length,
      });
    } catch (err) {
      cleanup();
      throw err;
    }
  }),
);

// ── Candidate drops a take before submitting ─────────────────────────────────
interviewRouter.delete('/:applicationId/answers/:questionId', requireAuth, wrap((req, res) => {
  const appId = v.int(req.params.applicationId, 'Application id', { min: 1 });
  const questionId = v.int(req.params.questionId, 'Question id', { min: 1 });
  const app = ownApplication(req, appId);

  if (req.user.role !== 'candidate') throw forbidden('Only the candidate can remove an answer.');
  if (app.interview_submitted_at) throw conflict('This interview is already submitted.');

  const answer = db.prepare('SELECT * FROM answers WHERE application_id = ? AND question_id = ?').get(appId, questionId);
  if (!answer) throw notFound('There is no recording for that question yet.');

  fs.rmSync(path.join(config.uploadDir, answer.audio_file), { force: true });
  db.prepare('DELETE FROM answers WHERE id = ?').run(answer.id);
  res.json({ ok: true });
}));

// ── Candidate submits the whole interview for evaluation ─────────────────────
interviewRouter.post('/:applicationId/submit', requireAuth, wrap(async (req, res) => {
  const appId = v.int(req.params.applicationId, 'Application id', { min: 1 });
  const app = ownApplication(req, appId);

  if (req.user.role !== 'candidate') throw forbidden('Only the candidate can submit an interview.');
  if (!INTERVIEW_OPEN.has(app.stage)) throw conflict('Your interview is not open right now.');
  if (app.interview_submitted_at) throw conflict('You have already submitted this interview.');

  const questions = questionsForJob(app.job_id);
  const answered = new Set(db.prepare('SELECT question_id FROM answers WHERE application_id = ?').all(appId).map((r) => r.question_id));
  const missing = questions.filter((q) => !answered.has(q.id));
  if (missing.length) {
    throw conflict(`Record an answer for every question first — ${missing.length} still to go.`);
  }

  db.prepare(`
    UPDATE applications
       SET stage = 'evaluation', interview_submitted_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?
  `).run(appId);

  logActivity({
    actorId: req.user.id, actorName: req.user.fullName,
    action: 'interview.submitted', entity: 'application', entityId: appId,
    detail: `${questions.length} answers · ${app.job_title}`,
  });

  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  await notify.notifyUnderReview({
    candidate: { email: app.candidate_email, full_name: app.candidate_name },
    job: { title: app.job_title },
    application: app,
    link: `${proto}://${req.get('host')}/app`,
  });

  res.json({ application: shapeApplication(loadApplication(appId)) });
}));

// ── Audio playback: the candidate who recorded it, or any admin ──────────────
interviewRouter.get('/audio/:answerId', requireAuth, wrap((req, res) => {
  const id = v.int(req.params.answerId, 'Answer id', { min: 1 });
  const answer = db.prepare(`
    SELECT an.*, a.candidate_id FROM answers an
      JOIN applications a ON a.id = an.application_id
     WHERE an.id = ?
  `).get(id);
  if (!answer) throw notFound('That recording does not exist.');
  if (req.user.role !== 'admin' && answer.candidate_id !== req.user.id) {
    throw forbidden('That recording is not yours.');
  }

  const file = path.join(config.uploadDir, answer.audio_file);
  let stat;
  try { stat = fs.statSync(file); } catch { throw notFound('That recording is missing from storage.'); }

  res.type(answer.mime_type || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.setHeader('Accept-Ranges', 'bytes');

  // Range support so the player can scrub instead of only playing straight through.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    let start = range[1] === '' ? null : Number(range[1]);
    let end = range[2] === '' ? null : Number(range[2]);
    if (start === null) {                      // suffix range: last N bytes
      start = Math.max(0, stat.size - (end ?? 0));
      end = stat.size - 1;
    } else if (end === null || end >= stat.size) {
      end = stat.size - 1;
    }
    if (start > end || start >= stat.size) {
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', end - start + 1);
    return fs.createReadStream(file, { start, end }).pipe(res);
  }

  res.setHeader('Content-Length', stat.size);
  return fs.createReadStream(file).pipe(res);
}));

// ── Admin scores a single answer; the application score is the running mean ──
interviewRouter.post('/answers/:answerId/evaluate', requireAdmin, wrap((req, res) => {
  const id = v.int(req.params.answerId, 'Answer id', { min: 1 });
  const answer = db.prepare('SELECT * FROM answers WHERE id = ?').get(id);
  if (!answer) throw notFound('That recording does not exist.');

  const score = v.num(req.body.score, 'Score', { min: 0, max: 10 });
  const feedback = v.str(req.body.feedback, 'Feedback', { required: false, max: 2000 });
  const transcript = v.str(req.body.transcript, 'Transcript', { required: false, max: 20000 });

  db.prepare(`
    UPDATE answers SET score = ?, feedback = ?, transcript = COALESCE(?, transcript),
           evaluated_by = ?, evaluated_at = datetime('now')
     WHERE id = ?
  `).run(score, feedback, transcript, req.user.id, id);

  const avg = db.prepare('SELECT AVG(score) AS s FROM answers WHERE application_id = ? AND score IS NOT NULL')
    .get(answer.application_id).s;
  db.prepare("UPDATE applications SET score = ?, updated_at = datetime('now') WHERE id = ?")
    .run(avg === null ? null : Math.round(avg * 100) / 100, answer.application_id);

  logActivity({
    actorId: req.user.id, actorName: req.user.fullName,
    action: 'answer.evaluated', entity: 'answer', entityId: id, detail: `score ${score}/10`,
  });

  res.json({ ok: true, score, applicationScore: avg === null ? null : Math.round(avg * 100) / 100 });
}));
