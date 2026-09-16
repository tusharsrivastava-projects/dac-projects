import { HttpError } from '../lib/http.js';

export function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'That endpoint does not exist.' });
  }
  next();
}

export function errorHandler(err, req, res, _next) {
  const status = err instanceof HttpError ? err.status : Number(err.status) || 500;

  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That recording is too large. Keep answers under the stated limit.' });
  }
  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  }

  const body = { error: status >= 500 ? 'Something went wrong on our side.' : err.message };
  if (err.details) body.details = err.details;
  res.status(status).json(body);
}
