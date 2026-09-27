/* Usage Management: allowances on active subscriptions, and recording a use. */
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { $, debounce, esc, fmtDate, icon, modal, toast } from '../../ui.js';
import { emptyState, usageMeter } from '../../components.js';
import { loadingRow, mount, on, planLabel, searchBox, setQuery, table } from './common.js';

export async function renderUsage({ view, query }) {
  let q = query.get('q') || '';
  const first = await api.get('/api/admin/usage', { q });
  let rows = first.subscriptions;

  const root = mount(view, `
    ${pageHead('Usage Management', 'Active subscriptions and what is left in the current monthly cycle. Allowances reset every month, even on multi-month plans.')}
    <div class="adm-toolbar">${searchBox(q, 'Search subscription ID, member or service')}</div>
    <div data-list></div>`);
  const listEl = $('[data-list]', root);

  const draw = () => {
    listEl.innerHTML = `<p class="muted small mb-8">${rows.length} active subscription${rows.length === 1 ? '' : 's'}, soonest to end first</p>${table([
      { label: 'Member', render: (s) => `<a class="cell-title" href="#/users/${s.user.id}">${esc(s.user.name)}</a><div class="cell-sub"><a class="mono" href="#/subscriptions/${esc(s.id)}">${esc(s.id)}</a></div>` },
      { label: 'Service', render: (s) => `<a href="#/services/${s.service.id}">${esc(s.service.name)}</a><div class="cell-sub">${esc(planLabel(s.months))} · ends ${esc(fmtDate(s.endDate))}</div>` },
      { label: 'Cycle', render: (s) => (s.usage.cycleStart ? `<span class="nowrap">${esc(fmtDate(s.usage.cycleStart))}</span><div class="cell-sub nowrap">to ${esc(fmtDate(s.usage.cycleEnd))}</div>` : '—') },
      { label: 'Usage', render: (s) => `<div class="adm-meter wide">${usageMeter(s.usage)}</div>` },
      { label: 'Allowed', cls: 'right', render: (s) => (s.usage.allowed == null ? '<span class="muted">Unlimited</span>' : `<span class="num">${s.usage.allowed}</span>`) },
      { label: 'Used', cls: 'right', render: (s) => `<span class="num">${s.usage.used}</span>` },
      { label: 'Remaining', cls: 'right', render: (s) => (s.usage.remaining == null ? '<span class="muted">∞</span>' : `<b class="num ${s.usage.remaining === 0 ? 'adm-bad' : ''}">${s.usage.remaining}</b>`) },
      {
        label: '',
        cls: 'nowrap',
        render: (s) => `<button type="button" class="btn btn-secondary btn-sm" data-record ${s.usage.remaining === 0 ? 'disabled title="Allowance used up for this cycle"' : ''}>${icon('plus', 'sm')} Record usage</button>`,
      },
    ], rows, {
      rowAttrs: (s) => `data-id="${esc(s.id)}"`,
      empty: emptyState({ ic: 'gauge', title: 'No active subscriptions', text: q ? 'Nothing matches that search.' : 'Usage appears once subscriptions are activated.' }),
    })}`;
  };
  draw();

  on(root, 'input', '[data-search]', debounce(async (e) => {
    q = e.target.value.trim();
    setQuery({ q });
    listEl.innerHTML = loadingRow;
    try { rows = (await api.get('/api/admin/usage', { q })).subscriptions; draw(); } catch (err) { toast(err.message, 'bad'); }
  }, 300));

  on(root, 'click', '[data-record]', async (e, btn) => {
    const s = rows.find((x) => x.id === btn.closest('[data-id]').dataset.id);
    const u = s.usage;
    const res = await modal({
      title: 'Record usage',
      body: `<p><b>${esc(s.user.name)}</b> · ${esc(s.service.name)} <span class="mono small muted">${esc(s.id)}</span></p>
        <div class="mt-16">${usageMeter(u)}</div>
        <div class="form-grid mt-16">
          <div class="field"><label for="u-units">${esc(u.unit.replace(/^./, (c) => c.toUpperCase()))} used</label><input id="u-units" class="input" type="number" name="units" min="1" max="${u.remaining ?? 100}" value="1" inputmode="numeric"></div>
          <div class="field"><label for="u-note">Note <span class="muted">(optional)</span></label><input id="u-note" class="input" name="note" maxlength="200" placeholder="e.g. Recorded at the front desk"></div>
        </div>`,
      confirm: 'Record usage',
      onSubmit: (f) => api.post(`/api/admin/subscriptions/${encodeURIComponent(s.id)}/usage`, { units: f.elements.units.value, note: f.elements.note.value.trim() }),
    });
    if (!res) return;
    s.usage = { ...s.usage, ...res.usage };
    toast(`Recorded. ${res.usage.remaining == null ? `${res.usage.used} used this cycle.` : `${res.usage.remaining} ${res.usage.unit} left this cycle.`}`);
    draw();
  });
}
