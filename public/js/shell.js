/* Sidebar + topbar + hash routing, shared by the candidate and admin apps. */
import { api } from './api.js';
import { $, el, esc, icon, initials, toast } from './ui.js';

export function currentRoute() {
  const raw = (window.location.hash || '#/').replace(/^#/, '');
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { path: `/${parts.join('/')}`, parts, query: new URLSearchParams(query || '') };
}

export const go = (path, { replace = false } = {}) => {
  const hash = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else if (replace) window.location.replace(hash);
  else window.location.hash = hash;
};

/** Guards the page, then hands back the signed-in user. */
export async function requireUser(expectedRole) {
  let user = null;
  try { ({ user } = await api.me()); } catch { /* fall through */ }

  if (!user) {
    window.location.replace('/');
    return new Promise(() => {}); // never resolves; the page is on its way out
  }
  if (expectedRole && user.role !== expectedRole) {
    window.location.replace(user.role === 'admin' ? '/admin' : '/app');
    return new Promise(() => {});
  }
  return user;
}

export function mountShell({ user, nav, roleLabel }) {
  $('#side-role').textContent = roleLabel;
  $('#side-avatar').textContent = initials(user.fullName);
  $('#side-name').textContent = user.fullName;
  $('#side-mail').textContent = user.email;
  $('#side-mail').title = user.email;

  renderNav(nav);

  $('#menu-toggle')?.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#scrim')?.addEventListener('click', () => document.body.classList.remove('nav-open'));

  $('#btn-logout').addEventListener('click', async () => {
    try { await api.logout(); } catch { /* sign out locally regardless */ }
    window.location.href = '/';
  });

  window.addEventListener('hashchange', () => document.body.classList.remove('nav-open'));
}

let navSpec = [];
export function renderNav(groups) {
  navSpec = groups;
  const host = $('#side-nav');
  host.innerHTML = '';
  for (const group of groups) {
    const g = el('div', { class: 'nav-group' });
    if (group.label) g.append(el('div', { class: 'nav-group-label', text: group.label }));
    for (const item of group.items) {
      g.append(el('a', {
        class: 'nav-item',
        href: `#${item.path}`,
        dataset: { path: item.path },
        html: `${icon(item.icon)}<span class="grow">${esc(item.label)}</span>${
          item.badge ? `<span class="nav-badge${item.hot ? ' is-hot' : ''}">${esc(item.badge)}</span>` : ''}`,
      }));
    }
    host.append(g);
  }
  highlightNav();
}

/** Re-renders just the badge counts without rebuilding the nav. */
export function setNavBadge(path, value, hot = false) {
  for (const group of navSpec) {
    for (const item of group.items) {
      if (item.path === path) { item.badge = value; item.hot = hot; }
    }
  }
  renderNav(navSpec);
}

export function highlightNav() {
  const { path } = currentRoute();
  for (const a of document.querySelectorAll('.nav-item')) {
    const p = a.dataset.path;
    const active = p === path || (p !== '/' && path.startsWith(`${p}/`));
    a.classList.toggle('is-active', active);
  }
}

export function setHeader({ title, sub = '', actions = [] }) {
  $('#page-title').textContent = title;
  $('#page-sub').textContent = sub;
  const host = $('#page-actions');
  host.innerHTML = '';
  for (const a of [].concat(actions)) if (a) host.append(a);
  document.title = `${title} — DAC Talent`;
}

const view = () => $('#view');

export function render(content) {
  const host = view();
  host.innerHTML = '';
  for (const c of [].concat(content)) {
    if (!c) continue;
    if (typeof c === 'string') host.insertAdjacentHTML('beforeend', c);
    else host.append(c);
  }
  host.scrollIntoView?.({ block: 'start' });
  window.scrollTo({ top: 0 });
}

export function renderLoading(lines = 3) {
  render(el('div', { class: 'stack' },
    Array.from({ length: lines }, (_, i) =>
      el('div', { class: 'skeleton', style: `height:${i === 0 ? 96 : 150}px` }))));
}

export function renderError(err, retry) {
  render(el('div', { class: 'card card-pad stack' }, [
    el('div', { class: 'alert alert-error' }, [
      el('span', { html: icon('alert'), style: 'line-height:0' }),
      el('span', { text: err?.message || 'Something went wrong loading this page.' }),
    ]),
    retry ? el('div', [el('button', { class: 'btn btn-ghost', type: 'button', text: 'Try again', onClick: retry })]) : null,
  ]));
}

/**
 * Wires a table of `'/path': handler` routes to the hash. Patterns may use
 * `:param` segments — matched values arrive as the handler's first argument.
 */
export function startRouter(routes, fallback = '/') {
  const compiled = Object.entries(routes).map(([pattern, handler]) => ({
    parts: pattern.split('/').filter(Boolean),
    handler,
    pattern,
  }));

  const dispatch = async () => {
    const { parts, query } = currentRoute();
    highlightNav();

    for (const route of compiled) {
      if (route.parts.length !== parts.length) continue;
      const params = {};
      let matched = true;
      for (const [i, seg] of route.parts.entries()) {
        if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(parts[i]);
        else if (seg !== parts[i]) { matched = false; break; }
      }
      if (!matched) continue;

      try {
        await route.handler(params, query);
      } catch (err) {
        if (err?.status === 401) { window.location.href = '/'; return; }
        console.error(err);
        renderError(err, dispatch);
        if (err?.status && err.status !== 404) toast(err.message, 'error');
      }
      return;
    }
    go(fallback, { replace: true });
  };

  window.addEventListener('hashchange', dispatch);
  if (!window.location.hash || window.location.hash === '#') go(fallback, { replace: true });
  else dispatch();
  return dispatch;
}
