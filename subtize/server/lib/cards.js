import { qrMatrix } from './upi.js';
import { today } from './dates.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmt = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/**
 * The digital subscription card as a standalone SVG, sized like a bank card
 * (85.6 × 54 mm at 300 dpi-ish proportions). Everything is inline, so it
 * renders the same when downloaded, printed, or shown on a phone at the door.
 */
export function cardSvg({ sub, service, holder, usage, verifyUrl }) {
  const W = 1012;
  const H = 638;
  const qr = qrMatrix(verifyUrl);
  const box = 236;
  const cell = box / (qr.length + 2);
  const qx = W - 64 - box;
  const qy = 170;
  let modules = '';
  qr.forEach((row, y) => row.forEach((on, x) => {
    if (on) modules += `M${(qx + (x + 1) * cell).toFixed(2)} ${(qy + (y + 1) * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
  }));

  const live = sub.status === 'active' && sub.end_date >= today();
  const statusText = live ? (sub.start_date > today() ? 'UPCOMING' : 'ACTIVE') : String(sub.status).toUpperCase();
  const statusFill = live ? '#22c55e' : '#3f4a44';
  const statusInk = live ? '#04130a' : '#e7ede9';
  const usageText = usage.allowed == null
    ? `Unlimited ${usage.unit} · ${usage.used} used this cycle`
    : `${usage.used} of ${usage.allowed} ${usage.unit} used · ${usage.remaining} left`;
  const pct = usage.allowed ? Math.min(1, usage.used / usage.allowed) : 0;
  // Shrink long names so they fit left of the QR instead of being cut off.
  const len = String(service.name).length;
  const titleSize = len <= 22 ? 42 : len <= 30 ? 34 : len <= 36 ? 29 : 25;

  const label = (x, y, k, val, size = 26) => `
    <text x="${x}" y="${y}" font-size="15" letter-spacing="2" fill="#8fa399" font-weight="600">${esc(k)}</text>
    <text x="${x}" y="${y + 34}" font-size="${size}" fill="#f2f7f4" font-weight="600">${esc(val)}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, 'Segoe UI', Roboto, Arial, sans-serif">
  <defs>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#22c55e"/><stop offset="1" stop-color="#16a34a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="36" fill="#0b0f0d"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="35" fill="none" stroke="#1f2a24" stroke-width="2"/>
  <rect x="0" y="0" width="${W}" height="10" rx="5" fill="url(#edge)"/>
  <circle cx="${W - 40}" cy="${H + 40}" r="220" fill="#22c55e" opacity="0.06"/>

  <g transform="translate(64 72)">
    <rect width="44" height="44" rx="12" fill="#22c55e"/>
    <path transform="scale(1.8333)" d="M16.6 7.4c-.9-1.4-2.4-2.2-4.2-2.2-2.4 0-4 1.2-4 2.9 0 1.8 1.4 2.5 4.1 3 2.8.6 4.3 1.4 4.3 3.3 0 1.8-1.7 3.1-4.3 3.1-2 0-3.6-.8-4.6-2.2" fill="none" stroke="#04130a" stroke-width="1.9" stroke-linecap="round"/>
    <text x="60" y="32" font-size="30" font-weight="700" fill="#f2f7f4">Subtize<tspan fill="#22c55e">.ai</tspan></text>
  </g>
  <text x="${W - 64}" y="92" font-size="15" letter-spacing="3" fill="#8fa399" text-anchor="end" font-weight="600">DIGITAL SUBSCRIPTION CARD</text>
  <rect x="${W - 64 - 132}" y="108" width="132" height="34" rx="17" fill="${statusFill}"/>
  <text x="${W - 64 - 66}" y="131" font-size="16" font-weight="700" letter-spacing="1.5" fill="${statusInk}" text-anchor="middle">${esc(statusText)}</text>

  <text x="64" y="196" font-size="15" letter-spacing="2" fill="#8fa399" font-weight="600">${esc(String(service.category).toUpperCase())}</text>
  <text x="64" y="244" font-size="${titleSize}" font-weight="700" fill="#f2f7f4">${esc(clip(service.name, 44))}</text>
  <text x="64" y="280" font-size="20" fill="#b9c8c0">${esc(clip(`${service.area}, ${service.city}`, 44))}</text>

  ${label(64, 336, 'MEMBER', clip(holder, 26), 28)}
  ${label(64, 430, 'SUBSCRIPTION ID', sub.public_id, 22)}
  ${label(330, 430, 'ACTIVATED', fmt(sub.start_date), 22)}
  ${label(500, 430, 'VALID TILL', fmt(sub.end_date), 22)}

  <text x="64" y="530" font-size="15" letter-spacing="2" fill="#8fa399" font-weight="600">USAGE THIS CYCLE</text>
  <rect x="64" y="546" width="600" height="12" rx="6" fill="#1f2a24"/>
  <rect x="64" y="546" width="${Math.max(12, 600 * pct).toFixed(1)}" height="12" rx="6" fill="#22c55e"${pct === 0 ? ' opacity="0.35"' : ''}/>
  <text x="64" y="590" font-size="18" fill="#dbe6e0">${esc(usageText)}</text>

  <rect x="${qx - 14}" y="${qy - 14}" width="${box + 28}" height="${box + 28}" rx="20" fill="#ffffff"/>
  <path d="${modules}" fill="#0b0f0d"/>
  <text x="${qx + box / 2}" y="${qy + box + 50}" font-size="15" fill="#8fa399" text-anchor="middle" letter-spacing="1">Scan to verify at the counter</text>
  <text x="${qx + box / 2}" y="${qy + box + 74}" font-size="13" fill="#5f7268" text-anchor="middle">Available: ${esc(service.days)}</text>
</svg>`;
}
