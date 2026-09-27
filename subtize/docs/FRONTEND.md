# Subtize.ai frontend guide

Plain HTML + ES modules, no build step, no framework. The server is the source of truth for every
rule (pricing, privacy, permissions); pages only present what the API returns.

## Hard rules

- **CSP is strict**: `script-src 'self'`. No inline `<script>`, no `onclick=""` attributes, no external
  scripts. Every page loads one module: `<script type="module" src="/js/pages/<name>.js"></script>`.
  Inline `style=""` attributes are allowed.
- **Escape everything** that goes into an HTML string with `esc()` from `ui.js`.
- **Money is in paise** in every API response. Format with `inr(paise)` / `inrShort(paise)`.
  When *sending* prices to the API (admin service form, coupons, proposed price), send **rupees**.
- **Dates**: `YYYY-MM-DD` strings for plan dates, `YYYY-MM-DD HH:MM:SS` (UTC) for timestamps.
  Use `fmtDate`, `fmtDateTime`, `fmtAgo`, `fmtMonth`.
- **Privacy**: explorers and members must never see provider/lister identity. The public API
  already strips it — don't add lister names anywhere in public or member UI.
- **Readability**: never put text on images or busy backgrounds. Use the tokens in `base.css`;
  don't invent new colours. Black + green, high contrast.
- **Destructive actions** (cancel, ban, suspend, delete, reject, terminate) always go through
  `confirmAction()` first.
- Every page must work at 360px wide. Test mobile.
- Do **not** edit the shared files (`css/base.css`, `js/ui.js`, `js/api.js`, `js/shell.js`,
  `js/components.js`, `js/site.js`, `js/ai.js`, `js/voice.js`, `js/pwa.js`). If you need extra styles,
  put them in your own stylesheet (`css/<area>.css`). If a shared helper is genuinely wrong, say so in
  your report instead of changing it.

## Page skeleton

```html
<!doctype html>
<html lang="en">
<head>
  <!-- contents of docs/head-snippet.html -->
  <title>Explore services · Subtize.ai</title>
  <link rel="stylesheet" href="/css/public.css">   <!-- your own, optional -->
</head>
<body>
  <div id="site-header"></div>      <!-- public pages -->
  <main>…</main>
  <div id="site-footer"></div>
  <script type="module" src="/js/pages/explore.js"></script>
</body>
</html>
```

Dashboards (`app.html`, `lister.html`, `admin.html`) have just `<div id="root"></div>` in the body;
`mountShell()` draws the sidebar, topbar, mobile drawer and (member app only) the bottom nav.

## Shared modules

| Module | What you get |
|---|---|
| `ui.js` | `$ $$ el html esc`, `inr inrShort fmtDate fmtDateShort fmtDateTime fmtAgo fmtMonth plural initials`, `DAYS DAY_SHORT DAY_LETTER`, `pill(status)` / `tonePill(text, tone)` / `statusLabel`, `icon(name, cls)`, `brand(href)`, `toast(msg, 'good'|'bad'|'info')`, `modal({...})`, `confirmAction({...})`, `formData(form)`, `showFieldError(form, err)`, `copyText`, `busy(btn, fn)`, `debounce`, `setTitle` |
| `api.js` | `api.get(url, params) / post / put / del / upload(url, FormData, method)`, `api.me()`, `api.logout()`, `ApiError {status, message, details}`, `toLogin()`, `homeFor(role)` |
| `shell.js` | `requireRole([...roles])`, `mountShell({user, roleLabel, nav, bottomNav, notifications, extraFoot})`, `route(pattern, handler, {title})`, `start()`, `go(path)`, `currentRoute()`, `setPageTitle`, `pageHead(title, sub, actionsHtml)`, `tabs(items, activeKey, basePath)`, `setBadge(path, n)`, `logout()` |
| `components.js` | `serviceCard(s, {href, cta, ctaHref})`, `serviceGrid(list, opts)`, `statTile({label, value, sub, ic, hero})`, `usageMeter(u, {big})`, `usageRing(u, size)`, `periodMeter(sub)`, `dayPicker(name, selected)`, `emptyState({ic, title, text, action})`, `revenueChart(host, rows, {payoutLabel, commissionLabel})`, `serviceTypeLabel` |
| `ai.js` | `mountAiBox(host, {context, onResult, examples, size, placeholder, initial})`, `askAssistant(text, {context, position})`, `getPosition()`, `savedPosition()`, `EXAMPLES` |
| `voice.js` | `voiceSupported`, `listen({...})`, `attachMic(button, input, onFinal, {status})`, `speak(text)` |
| `pwa.js` | Imported by `shell.js` and `site.js`. Any element with `data-action="download-app"` or `data-action="share-app"` (optional `data-path`) works automatically. Also `downloadApp()`, `shareApp({path, text})`. |
| `site.js` | `mountSite({active})` draws the public header + footer; resolves with the signed-in user or null. |

`icon()` names: home search sparkle compass layers card qr ticket gauge wallet user users settings logout
menu close check checkCircle plus minus mic micOff pin navigation calendar clock tag percent filter sliders
bell download upload share phone mail shield lock eye eyeOff alert info x trash edit chevron chevronDown
back arrowRight external copy file fileCheck briefcase store chart trend receipt signature scale activity
grid list refresh ban pause play star gift zap smartphone inbox globe — plus category icons dumbbell lotus
utensils shirt car book scissors music guitar waves desk milk trophy paw (the API's `category.icon`).

CSS building blocks (see `base.css`): `.container .stack .row .grid(.cols-2/3/4/.auto) .split .card(.flat/.tight/.link) .card-head
.btn(.btn-primary/-secondary/-outline/-ghost/-danger/-danger-outline, .btn-sm/.btn-lg/.btn-block/.btn-icon) .field .input .select
.textarea .input-group .check .form-grid .days/.day-toggle .segmented .chip/.chips .switch .dropzone .panel-note(.warn/.danger/.good)
.kv .pill .tone-* .badge .tag .offer-tag .table-wrap/.table .tabs/.tab .stats/.stat(.hero) .meter .ring .chart .legend .empty .loading
.skeleton .avatar .svc-card .price .modal .toast .voice-bar .ai-reply .page-head .eyebrow .muted .soft .mono .num .section .section-head`.

## Errors

API errors throw `ApiError`; `err.message` is written for end users — show it with `toast(err.message, 'bad')`
or `showFieldError(form, err)` (marks the field named in `err.details.field`). 401 inside a dashboard
route is handled by the router (it redirects to `/login?next=…`).

## Running it while you build

Use your own port and throwaway data dir so parallel work never collides:

```bash
cd subtize
export DATA_DIR=$(mktemp -d) PORT=47XX
node server/db/seed.js && node server/index.js &
```

Demo accounts: admin `admin@subtize.ai / subtize-admin-2026` · lister `lister@subtize.ai / lister12345` ·
lister awaiting e-sign `meera@subtize.ai / lister12345` · explorer `priya@subtize.ai / demo12345`.

Sign-up returns `devOtp` (the code) in local dev — show it in a clearly-labelled "Dev mode" note so the
flow can be completed without email.

Screenshot with Playwright (Chromium is pre-installed; do **not** run `playwright install`):

```js
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright');
```

## Page routes (server)

`/` index.html · `/explore` explore.html · `/services/:slug` service.html · `/login /signup /forgot /otp` auth.html ·
`/become-lister` become-lister.html · `/about /terms /privacy /payment-info /contact /download` info.html ·
`/verify/:code` verify.html · `/app` app.html · `/lister` lister.html · `/admin` admin.html · anything else 404.html.

## API map

Exact request/response shapes are in the route files — read the one you're building against.

| Area | File | Mount |
|---|---|---|
| Auth: register → OTP, login, OTP login, forgot/reset, me, logout, change password | `server/routes/auth.js` | `/api/auth` |
| Public: meta, services search/detail, assistant, coupons, card verify | `server/routes/public.js` (+ `server/lib/catalog.js` `publicService()` for the service shape, `server/lib/assistant.js` `resolve()` for the assistant shape) | `/api` |
| Member: overview, subscriptions (+cancel/exclude), exclusions, checkout quote/create, payments (+submit UTR/abandon), usage, cards (+SVG), profile, avatar, settings, notifications, referral | `server/routes/member.js` (+ `server/lib/subscriptions.js` `memberSubscription()`) | `/api/me` |
| Lister applications (multipart) | `server/routes/applications.js` | `/api/applications` |
| Lister dashboard | `server/routes/lister.js` | `/api/lister` |
| Admin: dashboard, users, listers, applications, agreements, settings, categories, activity, outbox, notifications | `server/routes/admin.js` | `/api/admin` |
| Admin: services, QR, images, change requests, coupons, payments, subscriptions, usage | `server/routes/adminCatalog.js` | `/api/admin` |
| Admin: revenue, settlements, reports (+CSV) | `server/routes/adminFinance.js` | `/api/admin` |

The API test `test/e2e.mjs` shows every flow being called in order — it is the quickest way to see
how the pieces fit.
