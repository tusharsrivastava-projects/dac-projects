import crypto from 'node:crypto';

const hex = (bytes) => crypto.randomBytes(bytes).toString('hex').toUpperCase();
const year = () => new Date().getFullYear();

export const userPublicId = () => `USR-${hex(4)}`;
export const servicePublicId = () => `SVC-${hex(3)}`;
export const subscriptionPublicId = () => `SUB-${year()}-${hex(4)}`;
export const paymentPublicId = () => `PAY-${year()}-${hex(4)}`;
export const applicationPublicId = (n) => `APP-${year()}-${String(n).padStart(4, '0')}`;
export const agreementPublicId = (n) => `AGR-${year()}-${String(n).padStart(4, '0')}`;
export const verificationId = () => `SUBV-${year()}-${hex(3)}`;
export const referralCode = () => crypto.randomBytes(4).toString('base64url').replace(/[-_]/g, 'x').slice(0, 6).toUpperCase();

/** Printed as the card QR. Long enough that guessing one is not a strategy. */
export const cardCode = () => crypto.randomBytes(12).toString('base64url');

/** Short reference the payer sees in their UPI app's note field. */
export const upiReference = () => `SBZ${hex(4)}`;

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'service';
}
