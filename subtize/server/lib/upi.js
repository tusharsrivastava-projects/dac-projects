import QRCode from 'qrcode';
import { toRupees } from './money.js';

/**
 * Builds the UPI intent for a checkout. The amount and the reference are
 * baked in, so a payer who scans it cannot quietly send a different amount
 * to a different account, and admins can match the credit to the order.
 * Only ever called with an official Subtize.ai VPA — never a provider's.
 */
export function upiIntent({ vpa, payee, amountPaise, reference, note }) {
  const params = new URLSearchParams({
    pa: vpa,
    pn: payee,
    am: toRupees(amountPaise).toFixed(2),
    cu: 'INR',
    tr: reference,
    tn: (note || `Subtize ${reference}`).slice(0, 60),
  });
  return `upi://pay?${params.toString()}`;
}

const QR_OPTS = { errorCorrectionLevel: 'M', margin: 1, color: { dark: '#0a0f0c', light: '#ffffff' } };

export const qrSvg = (text) => QRCode.toString(text, { ...QR_OPTS, type: 'svg' });
export const qrDataUrl = (text) => QRCode.toDataURL(text, { ...QR_OPTS, width: 320 });

/** Raw module matrix, for drawing a QR inside another SVG (the subscription card). */
export function qrMatrix(text) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) row.push(qr.modules.get(y, x) ? 1 : 0);
    rows.push(row);
  }
  return rows;
}
