import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { db } from './db/index.js';
import { purgeExpiredSessions } from './lib/auth.js';
import { smtpConfigured } from './lib/mailer.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { attachUser } from './middleware/session.js';
import { adminRouter } from './routes/admin.js';
import { applicationsRouter } from './routes/applications.js';
import { authRouter } from './routes/auth.js';
import { interviewRouter } from './routes/interview.js';
import { jobsRouter } from './routes/jobs.js';
import { offersRouter, publicOfferRouter } from './routes/offers.js';
import { questionsRouter } from './routes/questions.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
app.use(attachUser);

// Minimal request log — one line, no bodies.
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) {
      console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - started}ms)`);
    }
  });
  next();
});

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, smtp: smtpConfigured(), time: new Date().toISOString() }));

app.use('/api/auth', authRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/questions', questionsRouter);
app.use('/api/interview', interviewRouter);
app.use('/api/offers', offersRouter);
app.use('/api/public/offers', publicOfferRouter);
app.use('/api/admin', adminRouter);

app.use(express.static(config.publicDir, { extensions: ['html'], maxAge: '1h' }));

// Page routes. Each shell decides for itself whether the visitor may be there.
const page = (file) => (_req, res) => res.sendFile(path.join(config.publicDir, file));
app.get('/', page('index.html'));
app.get('/app', page('app.html'));
app.get(['/app/*'], page('app.html'));
app.get('/admin', page('admin.html'));
app.get(['/admin/*'], page('admin.html'));
app.get('/offer/:token', page('offer.html'));

app.use(notFoundHandler);
app.use((_req, res) => res.status(404).sendFile(path.join(config.publicDir, 'index.html')));
app.use(errorHandler);

const purged = purgeExpiredSessions();
if (purged) console.log(`Cleared ${purged} expired session(s).`);
setInterval(purgeExpiredSessions, 6 * 60 * 60 * 1000).unref();

const server = app.listen(config.port, config.host, () => {
  console.log(`\n  DAC HRM Platform`);
  console.log(`  ────────────────────────────────────────`);
  console.log(`  http://localhost:${config.port}`);
  console.log(`  db     ${config.dbFile}`);
  console.log(`  mail   ${smtpConfigured() ? 'SMTP configured' : 'outbox only (no SMTP_HOST set)'}`);
  console.log('');
});

const shutdown = (signal) => {
  console.log(`\n${signal} — shutting down.`);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app };
