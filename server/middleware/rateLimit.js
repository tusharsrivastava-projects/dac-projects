/**
 * In-memory rate limiting for the auth endpoints.
 *
 * Enough to make online password guessing pointless without dragging in Redis.
 * State is per-process, so a multi-instance deploy gets one bucket per
 * instance — still a big enough speed bump, and the honest trade for a hiring
 * tool that runs on one box.
 */
const buckets = new Map();

const prune = () => {
  const now = Date.now();
  for (const [key, entry] of buckets) if (entry.resetAt <= now) buckets.delete(key);
};
setInterval(prune, 5 * 60 * 1000).unref();

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.socket?.remoteAddress || 'unknown';

/**
 * @param {object} opts
 * @param {number} opts.max      attempts allowed inside the window
 * @param {number} opts.windowMs how long the window lasts
 * @param {Function} [opts.key]  what to count against; defaults to the caller's IP
 * @param {boolean} [opts.onlyFailures] count only responses >= 400, so a
 *   legitimate user signing in repeatedly is never locked out
 */
export function rateLimit({ max, windowMs, key = clientIp, onlyFailures = false, message }) {
  return (req, res, next) => {
    const id = `${req.path}|${key(req)}`;
    const now = Date.now();
    let entry = buckets.get(id);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(id, entry);
    }

    if (entry.count >= max) {
      const seconds = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', seconds);
      return res.status(429).json({
        error: message || `Too many attempts. Try again in ${seconds > 60 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`}.`,
      });
    }

    if (onlyFailures) {
      res.on('finish', () => { if (res.statusCode >= 400) entry.count += 1; });
    } else {
      entry.count += 1;
    }
    next();
  };
}

/** Counts against the IP and the submitted email, so neither alone is a way round it. */
export const loginKey = (req) =>
  `${clientIp(req)}|${String(req.body?.email || '').trim().toLowerCase()}`;

export const resetRateLimits = () => buckets.clear();
