/* Small DOM + formatting kit shared by both dashboards. */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escapes text destined for an innerHTML template. */
export const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function el(tag, attrs = {}, children = []) {
  // Allow el('div', [kids]) as well as el('div', {attrs}, [kids]).
  if (Array.isArray(attrs) || attrs instanceof Node || typeof attrs === 'string') {
    children = attrs;
    attrs = {};
  }
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/* ── Formatting ─────────────────────────────────────────────────────────── */

const asDate = (v) => {
  if (!v) return null;
  // SQLite datetime('now') is UTC without a zone marker.
  const d = new Date(/^\d{4}-\d{2}-\d{2} /.test(v) ? `${v.replace(' ', 'T')}Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function fmtDate(v) {
  const d = asDate(v);
  return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

export function fmtDateTime(v) {
  const d = asDate(v);
  return d ? d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
}

export function fmtAgo(v) {
  const d = asDate(v);
  if (!d) return '—';
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(v);
}

export const fmtClock = (secs) => {
  const s = Math.max(0, Math.round(secs || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const fmtBytes = (n) => {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
};

export const initials = (name) =>
  String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export const pill = (label, tone = 'neutral') =>
  `<span class="pill tone-${esc(tone)}">${esc(label)}</span>`;

/* ── Icons (inline so there is no icon-font request) ────────────────────── */

const ICONS = {
  home:      'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
  briefcase: 'M3.5 8.5h17v11h-17zM9 8.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2.5M3.5 13h17',
  file:      'M6 3h8l4 4v14H6zM14 3v4h4',
  mic:       'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3',
  award:     'M12 3a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM8.5 13.5 7 21l5-2.5L17 21l-1.5-7.5',
  user:      'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  users:     'M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14c2.4.7 4 2.6 4 6',
  help:      'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.6M12 17h.01',
  mail:      'M3.5 5.5h17v13h-17zM3.5 6.5l8.5 6 8.5-6',
  activity:  'M3 12h4l3 8 4-16 3 8h4',
  logout:    'M14.5 8V5.5h-10v13h10V16M9.5 12h11m0 0-3-3m3 3-3 3',
  menu:      'M4 7h16M4 12h16M4 17h16',
  close:     'M6 6l12 12M18 6 6 18',
  check:     'M4.5 12.5 9.5 17.5 19.5 6.5',
  plus:      'M12 5v14M5 12h14',
  search:    'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM17 17l4 4',
  play:      'M7 4.5v15l13-7.5z',
  send:      'M21 3 3 10.5l7 3 3 7z',
  inbox:     'M3.5 5.5h17v13h-17zM3.5 13h5l1.5 2.5h4L15.5 13h5',
  alert:     'M12 8v5m0 3h.01M10.3 3.8 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z',
  info:      'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 7.5h.01',
  lock:      'M6.5 10.5h11v9h-11zM8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5',
  clock:     'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5.5l3.5 2',
  trash:     'M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5 7.5 20h9l1-13.5M10 10v6.5M14 10v6.5',
  edit:      'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z',
  chevron:   'M9 5l7 7-7 7',
  back:      'M15 5l-7 7 7 7',
  stop:      'M6.5 6.5h11v11h-11z',
  download:  'M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 19.5h16',
  sparkle:   'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
};

export function icon(name, cls = '') {
  const d = ICONS[name] || ICONS.info;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" class="${esc(cls)}" aria-hidden="true"><path d="${d}"/></svg>`;
}

/* ── Toast ──────────────────────────────────────────────────────────────── */

let toastHost;
export function toast(message, kind = 'info', ms = 4200) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const node = el('div', { class: `toast${kind === 'error' ? ' is-error' : kind === 'good' ? ' is-good' : ''}` }, [
    el('span', { html: icon(kind === 'error' ? 'alert' : kind === 'good' ? 'check' : 'info'), style: 'flex:none;line-height:0;margin-top:1px' }),
    el('span', { class: 'grow', text: message }),
  ]);
  toastHost.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s, transform .2s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 220);
  }, ms);
  return node;
}

/* ── Modal ──────────────────────────────────────────────────────────────── */

/**
 * Opens a modal. `render(close)` returns the body node (or HTML string).
 * Returns { close, root }.
 */
export function modal({ title, subtitle = null, body, footer = null, wide = false, onClose = null }) {
  const host = el('div', { class: 'modal-host' });
  const close = (result) => {
    host.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.(result);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(null); };
  document.addEventListener('keydown', onKey);

  const box = el('div', { class: `modal${wide ? ' is-wide' : ''}`, role: 'dialog', 'aria-modal': 'true' });
  box.append(
    el('div', { class: 'modal-head' }, [
      el('div', { class: 'grow' }, [
        el('h2', { text: title }),
        subtitle ? el('div', { class: 'tiny muted', text: subtitle, style: 'margin-top:3px' }) : null,
      ]),
      el('button', { class: 'modal-close', type: 'button', 'aria-label': 'Close', html: icon('close'), onClick: () => close(null) }),
    ]),
  );

  const bodyNode = el('div', { class: 'modal-body' });
  const content = typeof body === 'function' ? body(close) : body;
  if (typeof content === 'string') bodyNode.innerHTML = content;
  else if (content) bodyNode.append(content);
  box.append(bodyNode);

  if (footer) {
    const footNode = el('div', { class: 'modal-foot' });
    const f = typeof footer === 'function' ? footer(close) : footer;
    if (typeof f === 'string') footNode.innerHTML = f;
    else footNode.append(...[].concat(f));
    box.append(footNode);
  }

  host.append(box);
  host.addEventListener('mousedown', (e) => { if (e.target === host) close(null); });
  document.body.append(host);
  box.querySelector('input, textarea, select, button')?.focus();
  return { close, root: box, body: bodyNode };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const m = modal({
      title,
      body: el('p', { class: 'muted', text: message }),
      footer: (close) => [
        el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onClick: () => { done(false); close(); } }),
        el('button', {
          class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', text: confirmLabel,
          onClick: () => { done(true); close(); },
        }),
      ],
      onClose: () => done(false),
    });
    return m;
  });
}

/* ── Misc ───────────────────────────────────────────────────────────────── */

/** Turns a submit handler into one that disables the button and shows a spinner. */
export function busy(button, label = 'Working…') {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner"></span>${esc(label)}`;
  return () => { button.disabled = false; button.innerHTML = original; };
}

export function emptyState({ iconName = 'inbox', title, message, action = null }) {
  return el('div', { class: 'empty' }, [
    el('div', { html: icon(iconName), style: 'line-height:0' }),
    el('h3', { text: title }),
    el('p', { class: 'muted', text: message, style: 'max-width:44ch;margin:0 auto' }),
    action,
  ]);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand?.('copy');
    ta.remove();
    return Boolean(ok);
  }
}
