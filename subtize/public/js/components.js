/* Reusable pieces that more than one screen draws. */
import { DAYS, DAY_LETTER, DAY_SHORT, esc, fmtMonth, icon, inr, inrShort } from './ui.js';

/* ── Service card ───────────────────────────────────────────────────────── */

const TYPE_LABEL = { in_person: 'At the venue', doorstep: 'Comes to you', online: 'Online' };
export const serviceTypeLabel = (t) => TYPE_LABEL[t] || t;

/**
 * The public service card. `href` decides where it links: /services/:slug on
 * public pages, #/services/:id inside the member app. Shows only public data.
 */
export function serviceCard(s, { href = `/services/${s.slug}`, cta = 'Subscribe', ctaHref = null } = {}) {
  const img = s.images?.[0];
  const mine = s.mySubscription;
  const minePill = mine ? `<span class="pill tone-${mine.status === 'active' ? 'good' : 'warn'}">${mine.status === 'active' ? 'Subscribed' : 'Pending'}</span>` : '';
  const offer = s.hasOffer ? `<span class="offer-tag">${icon('tag', 'sm')} ${esc(s.offerLabel)}</span>` : '<span></span>';
  const days = DAYS.map((d) => `<span class="${s.availableDays.includes(d) ? 'on' : ''}" title="${DAY_SHORT[d]}${s.availableDays.includes(d) ? ' — available' : ' — closed'}">${DAY_LETTER[d]}</span>`).join('');
  const full = s.spotsLeft === 0;
  return `
  <article class="svc-card" data-service="${s.id}">
    <div class="svc-media">
      ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<div class="icon-tile">${icon(s.category.icon)}</div>`}
      <div class="svc-badges">${offer}${minePill}</div>
    </div>
    <div class="svc-body">
      <div class="svc-cat">${esc(s.category.name)}</div>
      <h3><a href="${esc(href)}">${esc(s.name)}</a></h3>
      <p class="svc-desc">${esc(s.shortDescription)}</p>
      <div class="svc-meta">
        <span>${icon('pin')} ${esc(s.area)}${s.distanceKm != null ? ` · ${s.distanceKm} km` : ''}</span>
        <span>${icon(s.serviceType === 'online' ? 'globe' : s.serviceType === 'doorstep' ? 'home' : 'store')} ${serviceTypeLabel(s.serviceType)}</span>
      </div>
      <div class="svc-days" aria-label="Available ${esc(s.availableDayNames.join(', '))}">${days}</div>
      <div class="svc-subs">${icon('users')} ${esc(s.subscriberLabel)}${s.spotsLeft != null ? ` · ${full ? 'Full' : `${s.spotsLeft} spots left`}` : ''}</div>
      <div class="svc-foot">
        <div class="price">${inr(s.monthlyPrice)}<small> /month</small></div>
        ${mine ? `<a class="btn btn-secondary btn-sm" href="${esc(href)}">View</a>`
          : full ? '<button type="button" class="btn btn-secondary btn-sm" disabled>Full</button>'
            : `<a class="btn btn-primary btn-sm" href="${esc(ctaHref || href)}">${esc(cta)}</a>`}
      </div>
    </div>
  </article>`;
}

export const serviceGrid = (list, opts) => `<div class="grid auto" style="--min:270px">${list.map((s) => serviceCard(s, typeof opts === 'function' ? opts(s) : opts)).join('')}</div>`;

/* ── Stat tiles ─────────────────────────────────────────────────────────── */

export const statTile = ({ label, value, sub = '', ic = null, hero = false }) => `
  <div class="stat ${hero ? 'hero' : ''}">
    <div class="stat-label">${ic ? icon(ic) : ''}${esc(label)}</div>
    <div class="stat-value">${esc(value)}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
  </div>`;

/* ── Usage ──────────────────────────────────────────────────────────────── */

/** Horizontal usage meter with the numbers spelled out beside it. */
export function usageMeter(u, { big = false } = {}) {
  if (!u) return '';
  if (u.allowed == null) {
    return `<div class="row between small"><span class="soft">Unlimited ${esc(u.unit)}</span><span class="muted">${u.used} used this cycle</span></div>
      <div class="meter ${big ? 'lg' : ''}"><span style="width:100%;opacity:.35"></span></div>`;
  }
  const pct = Math.min(100, Math.round((u.used / Math.max(1, u.allowed)) * 100));
  const tone = pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : '';
  return `<div class="row between small"><span class="soft"><b class="num" style="color:var(--text)">${u.used}</b> of ${u.allowed} ${esc(u.unit)} used</span><span class="muted num">${u.remaining} left</span></div>
    <div class="meter ${tone} ${big ? 'lg' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="${u.allowed}" aria-valuenow="${u.used}" aria-label="Usage"><span style="width:${pct}%"></span></div>`;
}

/** Ring for the usage headline. */
export function usageRing(u, size = 128) {
  if (!u) return '';
  const pct = u.allowed == null ? 0 : Math.min(100, Math.round((u.used / Math.max(1, u.allowed)) * 100));
  const color = pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--green)';
  return `<div class="ring" style="--p:${pct};--size:${size}px;--ring-color:${color}" role="img" aria-label="${u.allowed == null ? `${u.used} used, unlimited` : `${u.used} of ${u.allowed} ${esc(u.unit)} used`}">
    <div><div><strong>${u.allowed == null ? '∞' : u.remaining}</strong><br><small>${u.allowed == null ? `${u.used} used` : `${esc(u.unit)} left`}</small></div></div></div>`;
}

/** Days-remaining meter for a plan period. */
export function periodMeter(sub) {
  if (!sub.startDate || !sub.endDate) return '';
  const total = Math.max(1, (new Date(sub.endDate) - new Date(sub.startDate)) / 864e5 + 1);
  const left = sub.remainingDays ?? 0;
  const pct = Math.max(0, Math.min(100, Math.round(((total - left) / total) * 100)));
  return `<div class="row between small"><span class="soft">${left} day${left === 1 ? '' : 's'} left</span><span class="muted">${Math.round(total)}-day plan</span></div>
    <div class="meter ${left <= 7 ? 'warn' : ''}"><span style="width:${pct}%"></span></div>`;
}

/* ── Day picker ─────────────────────────────────────────────────────────── */

export const dayPicker = (name, selected = []) => `<div class="days">${DAYS.map((d) => `
  <label class="day-toggle"><input type="checkbox" name="${name}" value="${d}" ${selected.includes(d) ? 'checked' : ''}><span>${DAY_SHORT[d]}</span></label>`).join('')}</div>`;

/* ── Empty state ────────────────────────────────────────────────────────── */

export const emptyState = ({ ic = 'inbox', title, text = '', action = '' }) => `
  <div class="empty"><div class="icon-tile">${icon(ic)}</div><h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}${action}</div>`;

/* ── Revenue chart ──────────────────────────────────────────────────────── */

/**
 * Stacked monthly bars: lister payout (bottom) + Subtize commission (top) = gross.
 * rows: [{ month: 'YYYY-MM', gross, commission, payable }], money in paise.
 * Two series, so there is a legend, direct labels on the latest bar only,
 * a hover tooltip per bar, and a table view for screen readers and exact values.
 */
export function revenueChart(host, rows, { payoutLabel = 'Lister payout', commissionLabel = 'Subtize.ai commission' } = {}) {
  const W = Math.max(300, Math.min(1100, Math.round(host.clientWidth || 640))); const H = 240; const padL = 52; const padR = 12; const padT = 16; const padB = 30;
  const max = Math.max(1, ...rows.map((r) => r.gross));
  const nice = niceMax(max);
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const step = plotW / Math.max(1, rows.length);
  const bw = Math.min(44, step * 0.56);
  const y = (v) => padT + plotH - (v / nice) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * nice);

  const bars = rows.map((r, i) => {
    const x = padL + step * i + (step - bw) / 2;
    const payout = r.gross - r.commission;
    const yPay = y(payout);
    const yGross = y(r.gross);
    const gap = r.commission > 0 && payout > 0 ? 2 : 0; // 2px surface gap between stacked segments
    const hPay = Math.max(0, padT + plotH - yPay);
    const hCom = Math.max(0, yPay - yGross - gap);
    return `<g class="bar" data-i="${i}">
      <rect class="hit" x="${padL + step * i}" y="${padT}" width="${step}" height="${plotH}"></rect>
      ${hPay ? `<path d="${roundedTop(x, yPay, bw, hPay, hCom ? 0 : 4)}" fill="var(--series-payout)"></path>` : ''}
      ${hCom ? `<path d="${roundedTop(x, yGross, bw, hCom, 4)}" fill="var(--series-commission)"></path>` : ''}
      <text class="axis-label" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(fmtMonth(r.month).split(' ')[0])}</text>
      ${i === rows.length - 1 && r.gross ? `<text class="value-label" x="${x + bw / 2}" y="${yGross - 6}" text-anchor="middle">${esc(inrShort(r.gross))}</text>` : ''}
    </g>`;
  }).join('');

  host.innerHTML = `
    <div class="row between wrap mb-16">
      <div class="legend"><span><i style="background:var(--series-payout)"></i>${esc(payoutLabel)}</span><span><i style="background:var(--series-commission)"></i>${esc(commissionLabel)}</span></div>
      <button type="button" class="btn btn-ghost btn-sm" data-toggle-table>${icon('list', 'sm')} Table</button>
    </div>
    <div class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly revenue: ${esc(payoutLabel)} and ${esc(commissionLabel)}">
        ${ticks.map((t) => `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"></line>
          <text class="axis-label" x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${esc(inrShort(t))}</text>`).join('')}
        ${bars}
      </svg>
      <div class="chart-tip" hidden></div>
    </div>
    <div class="table-wrap mt-16" hidden data-table>
      <table class="table"><thead><tr><th>Month</th><th class="right">Gross</th><th class="right">${esc(commissionLabel)}</th><th class="right">${esc(payoutLabel)}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(fmtMonth(r.month))}</td><td class="right num">${inr(r.gross)}</td><td class="right num">${inr(r.commission)}</td><td class="right num">${inr(r.gross - r.commission)}</td></tr>`).join('')}</tbody></table>
    </div>`;

  const tip = host.querySelector('.chart-tip');
  const svg = host.querySelector('svg');
  host.querySelectorAll('g.bar').forEach((g) => {
    g.addEventListener('mouseenter', () => {
      const r = rows[Number(g.dataset.i)];
      tip.innerHTML = `<div style="font-weight:700;margin-bottom:6px">${esc(fmtMonth(r.month))}</div>
        <div class="tip-row"><span>Gross</span><b>${inr(r.gross)}</b></div>
        <div class="tip-row"><span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--series-commission);margin-right:6px"></i>${esc(commissionLabel)}</span><b>${inr(r.commission)}</b></div>
        <div class="tip-row"><span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--series-payout);margin-right:6px"></i>${esc(payoutLabel)}</span><b>${inr(r.gross - r.commission)}</b></div>`;
      const box = svg.getBoundingClientRect();
      const scale = box.width / W;
      const i = Number(g.dataset.i);
      tip.style.left = `${(padL + step * i + step / 2) * scale}px`;
      tip.style.top = `${y(r.gross) * scale}px`;
      tip.hidden = false;
    });
    g.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
  host.querySelector('[data-toggle-table]').addEventListener('click', () => {
    const t = host.querySelector('[data-table]');
    t.hidden = !t.hidden;
  });
}

function niceMax(v) {
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

/** Bar path with rounded top corners only; the base sits flat on the axis or the segment below. */
function roundedTop(x, yTop, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${yTop + h} V${yTop + rr} Q${x},${yTop} ${x + rr},${yTop} H${x + w - rr} Q${x + w},${yTop} ${x + w},${yTop + rr} V${yTop + h} Z`;
}
