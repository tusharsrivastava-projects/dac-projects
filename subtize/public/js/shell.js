/*
 * Dashboard shell shared by the member app, the lister dashboard and the admin
 * console: sidebar (desktop), drawer + optional bottom nav (mobile), topbar
 * with notifications, and a tiny hash router.
 *
 *   const user = await requireRole(['user', 'lister']);
 *   const shell = mountShell({ user, roleLabel, nav, bottomNav, notifications });
 *   route('/subscriptions/:id', ({ params }) => renderDetail(params.id));
 *   start();
 */
import { api, homeFor, toLogin } from './api.js';
import { $, $$, brand, esc, fmtAgo, icon, initials, setTitle, toast } from './ui.js';
import './pwa.js';

/* ── Guard ──────────────────────────────────────────────────────────────── */

export async function requireRole(roles) {
  let user = null;
  try { ({ user } = await api.me()); } catch { /* treated as signed out */ }
  if (!user) { toLogin(); return new Promise(() => {}); }
  if (!roles.includes(user.role)) { location.replace(homeFor(user.role)); return new Promise(() => {}); }
  return user;
}

/* ── Shell ──────────────────────────────────────────────────────────────── */

let navSpec = [];
let bottomSpec = [];

/**
 * nav:        [{ group: 'Main', items: [{ path: '/', label: 'Dashboard', icon: 'home', badge?: 3, match?: '/subs' }] }]
 * bottomNav:  [{ path, label, icon }]  (exactly five; mobile only)
 * notifications: { list: () => Promise<{notifications, unread}>, markRead: () => Promise }
 * extraFoot:  HTML placed above the user block (e.g. Download / Share buttons)
 */
export function mountShell({ user, roleLabel, nav, bottomNav = null, notifications = null, extraFoot = '' }) {
  navSpec = nav;
  bottomSpec = bottomNav || [];
  if (bottomNav) document.body.classList.add('has-bottomnav');
  const root = $('#root');
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar" aria-label="Main navigation">
        <div class="sidebar-head">${brand(homeFor(user.role))}</div>
        <div class="sidebar-role"><span class="pill tone-good plain">${esc(roleLabel)}</span></div>
        <nav class="side-nav" id="side-nav"></nav>
        <div class="sidebar-foot">
          ${extraFoot}
          <div class="side-user">
            <div class="avatar">${user.avatarUrl ? `<img src="${esc(user.avatarUrl)}" alt="">` : esc(initials(user.fullName))}</div>
            <div class="who grow"><b>${esc(user.fullName)}</b><span title="${esc(user.email)}">${esc(user.email)}</span></div>
            <button class="btn btn-ghost btn-icon btn-sm" id="btn-logout" title="Log out" aria-label="Log out">${icon('logout')}</button>
          </div>
        </div>
      </aside>
      <div class="scrim" id="scrim"></div>
      <div class="main">
        <header class="topbar">
          <button class="btn btn-ghost btn-icon menu-toggle" id="menu-toggle" aria-label="Open menu">${icon('menu')}</button>
          <div class="page-title" id="page-title"></div>
          <div class="top-actions">
            ${notifications ? `<div class="bell" style="position:relative"><button class="btn btn-ghost btn-icon" id="bell" aria-label="Notifications">${icon('bell')}<span class="badge" id="bell-count" hidden></span></button><div class="notif-panel" id="notif-panel" hidden></div></div>` : ''}
          </div>
        </header>
        <main class="view" id="view" tabindex="-1"></main>
      </div>
      ${bottomNav ? `<nav class="bottom-nav" id="bottom-nav" aria-label="Quick navigation"></nav>` : ''}
    </div>`;

  renderNav();
  $('#menu-toggle').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
  $('#btn-logout').addEventListener('click', logout);
  window.addEventListener('hashchange', () => document.body.classList.remove('nav-open'));

  if (notifications) wireNotifications(notifications);
  return { refreshNav: renderNav, setBadge };
}

export async function logout() {
  try { await api.logout(); } catch { /* sign out locally regardless */ }
  location.href = '/';
}

function renderNav() {
  const current = currentRoute().path;
  $('#side-nav').innerHTML = navSpec.map((g) => `
    ${g.group ? `<div class="nav-group">${esc(g.group)}</div>` : ''}
    ${g.items.map((it) => `<a href="${it.href || `#${it.path}`}" data-path="${esc(it.path || '')}" class="${isActive(it, current) ? 'active' : ''}" ${it.id ? `id="${it.id}"` : ''}>
      ${icon(it.icon)}<span>${esc(it.label)}</span>${it.badge ? `<span class="badge">${esc(it.badge)}</span>` : ''}</a>`).join('')}`).join('');
  const bottom = $('#bottom-nav');
  if (bottom) {
    bottom.innerHTML = bottomSpec.map((it) => `<a href="#${it.path}" data-path="${esc(it.path)}" class="${isActive(it, current) ? 'active' : ''}">${icon(it.icon)}<span>${esc(it.label)}</span></a>`).join('');
  }
}

function isActive(item, current) {
  if (!item.path) return false;
  if (item.path === '/') return current === '/';
  const prefix = item.match || item.path;
  return current === item.path || current.startsWith(`${prefix}/`) || current === prefix;
}

/** Updates a nav badge by path (e.g. pending payments count). */
export function setBadge(path, value) {
  for (const g of navSpec) for (const it of g.items) if (it.path === path) it.badge = value || null;
  renderNav();
}

function wireNotifications({ list, markRead }) {
  const bell = $('#bell');
  const panel = $('#notif-panel');
  const count = $('#bell-count');
  const load = async () => {
    try {
      const { notifications = [], unread = 0 } = await list();
      count.hidden = !unread;
      count.textContent = unread > 9 ? '9+' : unread;
      panel.innerHTML = notifications.length
        ? notifications.map((n) => `<a class="notif-item ${n.read ? '' : 'unread'}" href="${esc(n.link || '#')}"><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span><br>` : ''}<span>${esc(fmtAgo(n.createdAt))}</span></a>`).join('')
        : '<div class="muted small" style="padding:14px">Nothing new.</div>';
    } catch { /* bell is optional */ }
  };
  bell.addEventListener('click', async (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !count.hidden) { try { await markRead(); count.hidden = true; } catch { /* ignore */ } }
  });
  document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target)) panel.hidden = true; });
  panel.addEventListener('click', (e) => { if (e.target.closest('a')) panel.hidden = true; });
  load();
  setInterval(load, 60_000);
}

/* ── Router ─────────────────────────────────────────────────────────────── */

const routes = [];

export function currentRoute() {
  const raw = (location.hash || '#/').replace(/^#/, '');
  const [path, query] = raw.split('?');
  const clean = `/${path.split('/').filter(Boolean).join('/')}`;
  return { path: clean, query: new URLSearchParams(query || '') };
}

export const go = (path, { replace = false } = {}) => {
  const hash = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else if (replace) location.replace(hash);
  else location.hash = hash;
};

/** route('/services/:id', handler) — handler({ params, query, view }) renders into #view. */
export function route(pattern, handler, { title = null } = {}) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; })}/?$`);
  routes.push({ re, keys, handler, title });
}

let renderId = 0;
async function render() {
  const { path, query } = currentRoute();
  const view = $('#view');
  const id = ++renderId;
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    renderNav();
    if (r.title) setPageTitle(r.title);
    view.innerHTML = '<div class="loading">Loading…</div>';
    window.scrollTo(0, 0);
    try {
      await r.handler({ params, query, view, isCurrent: () => id === renderId });
    } catch (err) {
      if (id !== renderId) return;
      if (err?.status === 401) { toLogin(); return; }
      view.innerHTML = `<div class="empty"><div class="icon-tile">${icon('alert')}</div><h3>That did not load</h3><p>${esc(err?.message || 'Something went wrong.')}</p><a class="btn btn-secondary" href="">Try again</a></div>`;
    }
    view.focus({ preventScroll: true });
    return;
  }
  view.innerHTML = `<div class="empty"><div class="icon-tile">${icon('compass')}</div><h3>Page not found</h3><p>That section does not exist.</p><a class="btn btn-primary" href="#/">Back to dashboard</a></div>`;
}

export function start() {
  window.addEventListener('hashchange', render);
  render();
}

export function setPageTitle(t) {
  const el = $('#page-title');
  if (el) el.textContent = t;
  setTitle(t);
}

/** Standard page header inside a view. */
export const pageHead = (title, sub = '', actions = '') => `
  <div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${actions ? `<div class="row wrap">${actions}</div>` : ''}</div>`;

/** Tabs driven by a ?tab= query param on the current route. */
export function tabs(items, active, basePath) {
  return `<div class="tabs" role="tablist">${items.map((t) => `<a role="tab" class="tab ${t.key === active ? 'active' : ''}" href="#${basePath}?tab=${t.key}" aria-selected="${t.key === active}">${esc(t.label)}${t.count != null ? `<span class="count">${t.count}</span>` : ''}</a>`).join('')}</div>`;
}

export { toast };
