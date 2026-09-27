/* #/explore — browse by category with the full filter panel. */
import { pageHead } from '../../shell.js';
import { $, $$, esc, icon } from '../../ui.js';
import { EMPTY, mountBrowser } from './browse.js';
import { getMeta, mountPage } from './common.js';

export async function renderExplore({ view, query, isCurrent }) {
  const meta = await getMeta();
  if (!isCurrent()) return;
  const coupon = (query.get('coupon') || '').toUpperCase();
  const initial = { ...EMPTY(), category: query.get('category') || '', q: query.get('q') || '', offers: query.get('offers') === '1' };

  const page = mountPage(view, `
    ${pageHead('Explore services', `${meta.stats.services} subscription services across ${meta.stats.areas} areas of ${esc(meta.platform.defaultCity)}. Filter by what matters to you.`,
    `<a class="btn btn-secondary" href="#/search">${icon('sparkle', 'sm')} Ask AI instead</a>`)}
    ${coupon ? `<div class="panel-note good mb-16">${icon('ticket')}<div>Coupon <b class="mono">${esc(coupon)}</b> will be filled in when you subscribe to any service below.</div></div>` : ''}
    <div class="chips scroll cat-chips mb-24" role="toolbar" aria-label="Categories">
      <button type="button" class="chip ${initial.category ? '' : 'active'}" data-cat="">${icon('grid')} All</button>
      ${meta.categories.map((c) => `<button type="button" class="chip ${initial.category === c.slug ? 'active' : ''}" data-cat="${esc(c.slug)}">${icon(c.icon)} ${esc(c.name)} <span class="muted">${c.services}</span></button>`).join('')}
    </div>
    <div data-browser></div>`);

  const syncChips = (slug) => $$('[data-cat]', page).forEach((b) => b.classList.toggle('active', b.dataset.cat === (slug || '')));

  const browser = await mountBrowser($('[data-browser]', page), {
    initial, coupon, showQuery: true,
    onChange: (s) => syncChips(s.category),
  });

  page.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    syncChips(chip.dataset.cat);
    browser.set({ ...browser.get(), category: chip.dataset.cat });
  });
}
