import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { db, notifyHooks } from './db/index.js';
import { bootstrap, isEmpty, KNOWN_DEFAULT_PASSWORDS } from './db/bootstrap.js';
import { purgeExpiredSessions } from './lib/auth.js';
import { llmEnabled } from './lib/llm.js';
import { sendMail, smtpConfigured } from './lib/mailer.js';
import { expireDue, remindExpiring } from './lib/subscriptions.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { attachUser } from './middleware/session.js';
import { adminRouter } from './routes/admin.js';
import { adminCatalogRouter } from './routes/adminCatalog.js';
import { adminFinanceRouter } from './routes/adminFinance.js';
import { applicationsRouter } from './routes/applications.js';
import { authRouter } from './routes/auth.js';
import { listerRouter } from './routes/lister.js';
import { memberRouter } from './routes/member.js';
import { publicRouter } from './routes/public.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  // Voice search needs the microphone, "near me" needs location, and listers scan
  // subscription cards with the camera. Nothing else.
  res.setHeader('Permissions-Policy', 'microphone=(self), geolocation=(self), camera=(self)');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
app.use(attachUser);

app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) console.log(`${req.method} ${req.originalUrl.split('?')[0]} → ${res.statusCode} (${Date.now() - started}ms)`);
  });
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, smtp: smtpConfigured(), ai: llmEnabled() ? 'claude' : 'rules', time: new Date().toISOString() }));

app.use('/api/auth', authRouter);
app.use('/api', publicRouter);
app.use('/api/me', memberRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/lister', listerRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin', adminCatalogRouter);
app.use('/api/admin', adminFinanceRouter);

// Only service photos and avatars are public. Lister documents and official
// QR images live in uploads/private and are streamed through access checks.
app.use('/uploads/services', express.static(path.join(config.uploadDir, 'services'), { maxAge: '7d', fallthrough: false }));
app.use('/uploads/avatars', express.static(path.join(config.uploadDir, 'avatars'), { maxAge: '1d', fallthrough: false }));

app.use(express.static(config.publicDir, { extensions: ['html'], maxAge: config.production ? '1h' : 0, index: false }));

const page = (file) => (_req, res) => res.sendFile(path.join(config.publicDir, file));
app.get('/', page('index.html'));
app.get('/explore', page('explore.html'));
app.get('/services/:slug', page('service.html'));
app.get(['/login', '/signup', '/forgot', '/otp'], page('auth.html'));
app.get('/become-lister', page('become-lister.html'));
app.get(['/about', '/terms', '/privacy', '/payment-info', '/contact', '/download'], page('info.html'));
app.get('/verify/:code', page('verify.html'));
app.get(['/app', '/app/*'], page('app.html'));
app.get(['/lister', '/lister/*'], page('lister.html'));
app.get(['/admin', '/admin/*'], page('admin.html'));

app.use(notFoundHandler);
app.use((_req, res) => res.status(404).sendFile(path.join(config.publicDir, '404.html')));
app.use(errorHandler);

if (isEmpty() && process.env.AUTO_BOOTSTRAP !== 'false') {
  const seeded = bootstrap({ demo: process.env.SEED_DEMO_DATA === 'true' });
  console.log(`Bootstrapped an empty database: admin ${config.seedAdmin.email}${seeded.services ? `, ${seeded.services} demo services` : ''}.`);
}

{
  const pw = config.seedAdmin.password;
  const publicFacing = Boolean(config.baseUrl) || config.production;
  let problem = null;
  if (KNOWN_DEFAULT_PASSWORDS.has(pw)) problem = 'still uses the default password from the repo';
  else if (pw.length < 10) problem = `has a ${pw.length}-character password, which is short enough to guess`;
  if (problem) {
    const flag = publicFacing ? '!!! ' : '';
    console.warn(`\n  ${flag}The admin account ${problem}.\n  ${flag}Set ADMIN_PASSWORD before this goes anywhere real.\n`);
  }
}

// In-app notices to members and listers also go by email, unless they turned
// that off. Admins work from their queues, so they are not emailed per item.
notifyHooks.after = (userId, n) => {
  const u = db.prepare('SELECT email, role, notify_email, status FROM users WHERE id = ?').get(userId);
  if (!u || u.role === 'admin' || !u.notify_email || u.status !== 'active') return;
  const link = n.link ? `${config.baseUrl || `http://localhost:${config.port}`}${n.link}` : '';
  sendMail({ to: u.email, subject: n.title, text: [n.body, link && `Open: ${link}`, '— Subtize.ai'].filter(Boolean).join('\n\n') })
    .catch(() => {});
};

const housekeeping = () => { purgeExpiredSessions(); expireDue(); remindExpiring(); };
housekeeping();
setInterval(housekeeping, 60 * 60 * 1000).unref();

const server = app.listen(config.port, config.host, () => {
  console.log('\n  Subtize.ai');
  console.log('  ────────────────────────────────────────');
  console.log(`  http://localhost:${config.port}`);
  console.log(`  db     ${config.dbFile}`);
  console.log(`  mail   ${smtpConfigured() ? 'SMTP configured' : 'outbox only (codes shown on screen in dev)'}`);
  console.log(`  search ${llmEnabled() ? `Claude (${config.anthropic.model}) with rule fallback` : 'built-in parser (set ANTHROPIC_API_KEY for Claude)'}\n`);
});

const shutdown = (signal) => {
  console.log(`\n${signal} — shutting down.`);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app };
