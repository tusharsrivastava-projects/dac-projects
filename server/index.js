import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { db } from './db/index.js';
import { bootstrap, isEmpty, KNOWN_DEFAULT_PASSWORDS } from './db/bootstrap.js';
import { purgeExpiredSessions } from './lib/auth.js';
import { smtpConfigured } from './lib/mailer.js';
import { checkStorage, describeDriver, setLastCheck, usingDrive } from './lib/storage.js';
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

// A fresh deploy would otherwise have no way in. Only fires on an empty
// database, so it never disturbs a running installation.
if (isEmpty() && process.env.AUTO_BOOTSTRAP !== 'false') {
  const seeded = bootstrap({ demo: process.env.SEED_DEMO_DATA !== 'false' });
  console.log(`Bootstrapped an empty database: admin ${config.seedAdmin.email}, ${seeded.jobs} role(s), ${seeded.questions} question(s).`);
}

// The admin account guards every application and recording, so say something
// when its password would not survive a guess. Never print the password.
{
  const pw = config.seedAdmin.password;
  const publicFacing = Boolean(config.baseUrl) || process.env.NODE_ENV === 'production';
  const flag = publicFacing ? '!!! ' : '';
  let problem = null;

  if (KNOWN_DEFAULT_PASSWORDS.has(pw)) {
    problem = 'still uses the default password from the repo, which anyone who has read the source knows';
  } else if (pw.length < 10) {
    problem = `has a ${pw.length}-character password, which is short enough to guess`;
  }

  if (problem) {
    console.warn(
      `\n  ${flag}The admin account ${problem}.` +
      `\n  ${flag}Set ADMIN_PASSWORD to something long, or change it under Profile once you are in.\n`,
    );
  }
}

const purged = purgeExpiredSessions();
if (purged) console.log(`Cleared ${purged} expired session(s).`);
setInterval(purgeExpiredSessions, 6 * 60 * 60 * 1000).unref();

const server = app.listen(config.port, config.host, async () => {
  console.log(`\n  DAC HRM Platform`);
  console.log(`  ────────────────────────────────────────`);
  console.log(`  http://localhost:${config.port}`);
  console.log(`  db     ${config.dbFile}`);
  console.log(`  audio  ${describeDriver()}`);
  console.log(`  mail   ${smtpConfigured() ? 'SMTP configured' : 'outbox only (no SMTP_HOST set)'}`);
  console.log('');

  // Checked here rather than on the first upload, so a wrong folder id or an
  // expired refresh token is obvious at boot instead of halfway through
  // somebody's interview.
  if (usingDrive()) {
    const result = await checkStorage();
    setLastCheck(result);
    if (result.ok) {
      console.log(`  Drive folder ready${result.created ? ' (created just now)' : ''}: ${result.name}`);
      console.log(`  ${result.link}\n`);
    } else {
      console.error(`\n  !!! Google Drive is not usable: ${result.error}`);
      console.error('  !!! Recordings will fall back to local disk, which a free Render instance wipes on restart.\n');
    }
  }
});

const shutdown = (signal) => {
  console.log(`\n${signal} — shutting down.`);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app };
