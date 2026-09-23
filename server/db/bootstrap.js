import fs from 'node:fs';
import { db, setSetting } from './index.js';
import { config } from '../config.js';
import { hashPassword } from '../lib/auth.js';
import { jobCode } from '../lib/ids.js';

/** Passwords we ship in the repo. Never acceptable on a public deploy. */
export const KNOWN_DEFAULT_PASSWORDS = new Set(['dac-admin-2026', 'candidate123']);

const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

export const isEmpty = () => count('users') === 0;

export function wipe() {
  db.pragma('foreign_keys = OFF');
  for (const t of ['answers', 'offers', 'questions', 'applications', 'jobs', 'sessions', 'mail_outbox', 'activity_log', 'users', 'settings']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.prepare('DELETE FROM sqlite_sequence').run();
  db.pragma('foreign_keys = ON');
  for (const f of fs.readdirSync(config.uploadDir)) {
    if (f !== '.gitkeep') fs.rmSync(`${config.uploadDir}/${f}`, { force: true });
  }
}

function upsertUser(u) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(u.email);
  if (existing) return { id: existing.id, created: false };
  const id = db.prepare(
    'INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)',
  ).run(u.full_name, u.email, u.phone ?? null, hashPassword(u.password), u.role).lastInsertRowid;
  return { id, created: true };
}

/** Idempotent: creates the admin account only if that email is not taken. */
export function ensureAdmin() {
  const { id, created } = upsertUser({
    full_name: config.seedAdmin.name,
    email: config.seedAdmin.email,
    phone: null,
    password: config.seedAdmin.password,
    role: 'admin',
  });
  setSetting('org.name', config.org.name);
  setSetting('org.signatory', config.org.signatory);
  setSetting('org.signatory_name', config.org.signatoryName);
  return { adminId: id, created };
}

const JOBS = [
  {
    title: 'Machine Learning Intern',
    employment_type: 'Internship',
    stipend: '₹15,000 / month',
    openings: 4,
    summary: 'Train, evaluate and ship small models that go into DAC student products.',
    description: `You will work alongside the DGU AI Cell research team on applied ML problems.

What you will do
• Build datasets, clean them, and keep them versioned.
• Fine-tune small open models and measure them honestly.
• Turn a notebook into something that actually runs in production.
• Write short, readable notes on what worked and what did not.

What we look for
• Comfortable with Python, NumPy and PyTorch or TensorFlow.
• You have trained at least one model end to end, even a toy one.
• You can explain a trade-off out loud without hand-waving.`,
  },
  {
    title: 'AI Product Engineer',
    employment_type: 'Full-time',
    stipend: '₹6 – 9 LPA',
    openings: 2,
    summary: 'Own the product surface of DAC tools — from API to the screen a student sees.',
    description: `The AI Cell ships internal tools used across DBS Global University.

What you will do
• Build and maintain full-stack features (Node, React or plain JS, SQL).
• Wire LLM and speech APIs into real workflows, with sane fallbacks.
• Care about latency, accessibility and what happens when the network drops.

What we look for
• 1+ year building and shipping web software.
• You can read someone else's code without rewriting it first.`,
  },
  {
    title: 'Data Annotation Associate',
    employment_type: 'Part-time',
    stipend: '₹8,000 / month',
    openings: 6,
    summary: 'Label and quality-check the datasets that everything else at DAC depends on.',
    description: `Careful, patient work that decides whether our models are any good.

What you will do
• Label text, audio and image data against a written rubric.
• Flag edge cases instead of guessing.
• Run second-pass QA on a teammate's batch.

What we look for
• Attention to detail and a habit of asking rather than assuming.
• Comfortable with spreadsheets and basic Python is a plus.`,
  },
];

const QUESTIONS = [
  [null, 'Walk us through who you are and why the DGU AI Cell interests you.', 'Keep it under two minutes. We care about the why.', 30, 120, 1],
  [null, 'Tell us about a project you finished. What broke, and how did you fix it?', 'Be specific — a real bug beats a polished summary.', 45, 180, 2],
  [null, 'A teammate disagrees with your technical call. What do you actually do?', null, 30, 120, 3],
  ['Machine Learning Intern', 'Your model scores 97% on the test set. Why might that be bad news?', 'Think leakage, class balance, and what the metric hides.', 45, 150, 4],
  ['Machine Learning Intern', 'Explain overfitting to a first-year student who has never written code.', null, 30, 120, 5],
  ['AI Product Engineer', 'An LLM API you depend on starts timing out in production. Talk through your response.', 'We want the order of operations, not a perfect answer.', 45, 180, 4],
  ['AI Product Engineer', 'How do you decide something is done enough to ship?', null, 30, 120, 5],
  ['Data Annotation Associate', 'Two annotators label the same item differently. How should that get resolved?', null, 30, 120, 4],
];

/** Sample roles, questions and a demo candidate. Skipped if roles already exist. */
export function ensureDemoData(adminId, { withCandidate = true } = {}) {
  const out = { jobs: 0, questions: 0, candidate: false };

  const insertJob = db.prepare(`
    INSERT INTO jobs (code, title, department, location, employment_type, stipend, summary, description, openings, status, created_by)
    VALUES (@code, @title, @department, @location, @employment_type, @stipend, @summary, @description, @openings, 'open', @created_by)`);

  const jobIds = {};
  for (const j of JOBS) {
    const existing = db.prepare('SELECT id FROM jobs WHERE title = ?').get(j.title);
    if (existing) { jobIds[j.title] = existing.id; continue; }
    jobIds[j.title] = insertJob.run({
      ...j,
      code: jobCode(j.title),
      department: 'DGU AI Cell',
      location: 'Dehradun, IN (hybrid)',
      created_by: adminId,
    }).lastInsertRowid;
    out.jobs += 1;
  }

  const insertQ = db.prepare(`
    INSERT INTO questions (job_id, prompt, hint, think_seconds, answer_seconds, position, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const [jobTitle, prompt, hint, think, answer, pos] of QUESTIONS) {
    if (db.prepare('SELECT 1 FROM questions WHERE prompt = ?').get(prompt)) continue;
    insertQ.run(jobTitle ? jobIds[jobTitle] : null, prompt, hint, think, answer, pos, adminId);
    out.questions += 1;
  }

  if (withCandidate) {
    const { created } = upsertUser({
      full_name: 'Aarav Mehta',
      email: 'aarav.demo@dgu.ac.in',
      phone: '+91 98765 43210',
      password: 'candidate123',
      role: 'candidate',
    });
    out.candidate = created;
  }

  return out;
}

/**
 * Brings an empty database up to a usable state: an admin account, and
 * nothing else.
 *
 * Sample roles and questions are deliberately opt-in. A fresh install is a
 * real hiring board, and candidates should never be shown invented openings
 * they could apply to — the admin posts the real ones.
 */
export function bootstrap({ demo = false } = {}) {
  const { adminId, created } = ensureAdmin();
  const data = demo ? ensureDemoData(adminId, { withCandidate: demo === 'full' }) : { jobs: 0, questions: 0, candidate: false };
  return { adminId, adminCreated: created, ...data };
}
