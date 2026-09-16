import crypto from 'node:crypto';

/** Unguessable public token for offer-letter links. */
export const offerToken = () => crypto.randomBytes(24).toString('base64url');

/** DAC-ML-7F3A style job codes. */
export function jobCode(title) {
  const initials = String(title || 'ROLE')
    .replace(/[^a-zA-Z\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'RL';
  return `DAC-${initials}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

/** Human-facing offer reference, e.g. DAC/OFR/2026/0042. */
export const offerReference = (applicationId) =>
  `DAC/OFR/${new Date().getFullYear()}/${String(applicationId).padStart(4, '0')}`;
