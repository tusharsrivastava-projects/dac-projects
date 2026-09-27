import { HttpError } from '../lib/http.js';

export function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'That endpoint does not exist.' });
  next();
}

export function errorHandler(err, req, res, _next) {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That file is too large. Keep uploads under 5 MB.' });
  }
  if (err?.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: `Unexpected file field: ${err.field}.` });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That request is too large.' });
  }
  const status = err instanceof HttpError ? err.status : Number(err.status) || 500;
  if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  const body = { error: status >= 500 ? 'Something went wrong on our side.' : err.message };
  if (err.details) body.details = err.details;
  res.status(status).json(body);
}
