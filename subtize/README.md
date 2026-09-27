<p align="center"><img src="public/icons/icon-192.png" width="96" alt="Subtize.ai"></p>

<h1 align="center">Subtize.ai</h1>

<p align="center"><b>Avail 100+ subscription-based services for a month. Manage and cancel everything from a single platform.</b></p>

---

Somebody in Dehradun pays a gym by UPI, a tiffin service in cash, a laundry app through its own wallet, and a car cleaner who just shows up every morning. Four providers, four ways to cancel, and no single place that says what renews when.

Subtize.ai puts all of that on one screen. Members find nearby monthly services by typing or talking ("gym near me under ₹1,000"), pay one official Subtize.ai QR, and get a digital card to show at the counter. From the same dashboard they track how many visits are left and cancel anything without phoning anyone. Providers apply as **listers**, get verified, e-sign an agreement, and see a monthly statement: Subtize.ai keeps 20%, they get 80%.

It lives in this folder as its own app. The DAC HRM platform at the repository root is separate and untouched.

## Run it

Node 20.12 or newer.

```bash
cd subtize
npm install
npm run seed     # categories, Dehradun areas, admin, and the demo catalogue
npm start        # http://localhost:4600
```

The demo is a whole working town: 105 services across 15 categories, five approved listers, about 180 members with six months of payment history, coupons, pending payments waiting for an admin, applications at every stage, and paid settlements.

| Who | Email | Password | What they see |
|---|---|---|---|
| Admin | `admin@subtize.ai` | `subtize-admin-2026` | The console, with queues already filled |
| Lister | `lister@subtize.ai` | `lister12345` | Fit Nation Ventures: gyms and sports, revenue, settlements |
| Lister, unsigned | `meera@subtize.ai` | `lister12345` | Approved, agreement waiting for her e-signature |
| Explorer | `priya@subtize.ai` | `demo12345` | Active, expiring, expired, cancelled and pending plans |

`npm run reset` wipes the database and uploads and reseeds. `npm run seed -- --empty` gives you only the baseline (no demo services), which is what a real launch wants.

Sign-up asks for a six-digit email code. With no SMTP configured and `NODE_ENV` not set to `production`, the code is shown on screen in a labelled "dev mode" note, so you can finish the flow locally. In production it is never returned.

## How a subscription happens

1. **Search.** Type or speak. The request becomes filters: category, price, distance, days, plan length, offers, service type. The results show only public information.
2. **Choose a plan** (1, 3, 6 or 12 months, whatever that service offers) and apply a coupon. The server quotes the exact amount.
3. **Pay the official QR.** Checkout builds a UPI intent (`upi://pay?pa=…&am=…&tr=…`) for the official Subtize.ai collection account with the amount and a reference baked in. A provider's personal UPI never appears as a payee. Admins can also attach a static QR image their bank issued for that account.
4. **Submit the UPI Transaction ID.** The payment moves to *Pending verification*. A UTR can be used once across the whole platform, so a screenshot can't be recycled.
5. **Admin verifies,** then activates. That's usually one "Verify & activate" click; they can be split if someone needs to check the bank statement first. Rejection needs a reason, and the member sees it.
6. **Active.** Dates are set (a renewal starts the day after the current plan ends), usage limits are snapshotted, and a digital card is generated.
7. **Track and manage.** Usage resets monthly even on multi-month plans. Members can cancel, or *exclude* a service so it disappears from their search entirely.

The card is an SVG with the member's name, subscription ID, dates, usage and a QR. Scanning the QR opens `/verify/<code>`, which tells staff whether the plan is valid today and shows the holder as "Priya S." with no email or phone. Listers can also check members in from their dashboard by scanning or typing the code, which records a visit.

## Who can see what

This was the non-negotiable part of the brief, so it's enforced on the server rather than hidden in the UI.

- **Explorers and members** get services through one allow-listed projection (`publicService()` in `server/lib/catalog.js`). Lister IDs, provider names, contacts, internal notes and payment configuration are never copied into it. The API test fails if any of them show up in search, service detail, or checkout.
- **Listers** get only their own services and subscribers, and subscriber records carry names, not contact details. They can edit descriptions, images, days, hours and usage rules. Price, plan lengths, the payment QR, commission and settlement are refused with a 403; they file a change request, and an admin approves it.
- **Admins** see everything, but lister bank account numbers, ID numbers and settlement UPI handles are AES-256-GCM encrypted at rest and come back masked. Revealing them is a deliberate click, and it's written to the activity log. Uploaded documents live outside the public folder and are streamed through an access check.

Sessions are httpOnly cookies whose tokens are stored hashed. Pages ship a strict CSP (`script-src 'self'`, no inline handlers). Suspending or banning someone signs them out everywhere immediately.

## Becoming a lister

`/become-lister` explains the deal, then takes the application: business details, verification numbers, address proof, bank details, documents, and an acknowledgement of the 20% clause.

From the admin side it goes: *Applied → Under review → (Verification required → resubmitted) → Approved*, or *Rejected* / *Suspended*. Approval is blocked until both "documents verified" and "address verified" are ticked. It then issues a verification ID (`SUBV-2026-…`), switches the account to the Lister role and creates the agreement.

It's written in English and Hindi, and the commission clause reads exactly as specified:

> Subtize.ai will retain 20% of the total subscription revenue generated through the Lister's services on the platform during a month. The remaining 80% will be payable to the Lister according to the applicable monthly settlement process.

Next, the lister draws a signature on a pad and types their name. Subtize.ai countersigns, the agreement goes active, and only then can their services be published. Either side can download the signed copy as a self-contained HTML file that prints cleanly to PDF.

## Money

Everything is stored in paise, so percentage coupons and the commission never drift by a rupee. Revenue lands in the month its payment was verified. For each lister:

```
gross verified subscriptions − 20% Subtize.ai commission = lister settlement
₹10,000                      − ₹2,000                     = ₹8,000
```

The rate comes from the lister's signed agreement, so changing the platform default in Settings doesn't rewrite deals already signed. Services run by Subtize.ai directly (no lister) count as platform income. Admins generate a month's settlements, move them through pending → processing → paid (paid needs a payout reference), and download the monthly report and payments ledger as CSV.

## AI search and voice

The browser's speech recognition turns speech into text (Chrome, Edge, Safari). The server then works out what the person wants:

| They say | What happens |
|---|---|
| "Find a gym subscription near me under ₹1,000" | Gyms within 5 km, max ₹1,000/month |
| "yoga on weekends in Rajpur Road" | Yoga, open Sat and Sun, around Rajpur Road |
| "only under 800" | Keeps the current filters, adds the price cap |
| "Is Iron Paradise Gym Rajpur Road open on Sunday?" | "…is not available on Sunday. It runs Monday to Saturday." |
| "subscribe me to the cheapest laundry near me" | Picks the service and opens checkout |
| "apply coupon FIT20, three months" (on checkout) | Fills the coupon and plan fields |
| "my transaction id is 4 1 9 2 0 0 …" | Joins the digits into a UTR and fills it |

Out of the box a rule-based parser handles this (`server/lib/assistant.js`) with no network calls. Set `ANTHROPIC_API_KEY` and Claude reads each request first, with a fixed JSON schema, low effort and server-side refusal fallback. If that call fails for any reason, the rule parser takes over. Either way the result is grounded against the real catalogue before anything is shown.

## Tests

```bash
npm test        # boots a throwaway server + demo data and runs test/e2e.mjs
npm run test:ui # browser walk-through with Playwright (needs Chromium)
```

The API suite is 96 checks through every flow above, including the privacy rules: no provider data in any member-facing response, listers locked out of each other's services and the admin API, UTR reuse refused, suspended users signed out on the spot.

## Deploying

It's one Node process and one SQLite file, so any host with a persistent disk works. On Render: a Web Service with root directory `subtize`, build `npm ci`, start `npm start`, plus a disk mounted at the path you give `DATA_DIR`.

Set these before anyone real signs up:

- `ADMIN_PASSWORD`: the server warns on every boot while the repo default is in use.
- `DATA_KEY`: 64 hex characters (`openssl rand -hex 32`). Without it a key is generated next to the database, which is fine locally and wrong on a server. Lose it and the encrypted bank fields can't be read.
- `BASE_URL`, so card QR codes and share links point at the real address (picked up automatically on Render).
- `COOKIE_SECURE=true` behind HTTPS, and SMTP so codes arrive by email.
- `PLATFORM_UPI_ID` and `PLATFORM_PAYEE`: the account every checkout QR pays. Admins can change them later in Settings.

Every variable is documented in `.env.example`; a local `.env` is loaded automatically.

## Install as an app

There's no app store build. Subtize.ai is a PWA: "Download App" triggers the browser's install prompt on Android and desktop, and shows the Add to Home Screen steps on iPhone. Installed, it opens straight into the member dashboard with a bottom bar (Home, AI Search, Explore, Subscriptions, Profile). "Share App" uses the phone's share sheet and adds the member's referral code to the link.

## Layout

```
server/
  index.js            routes, security headers, boot
  db/                 schema.sql, bootstrap + demo data, seed CLI
  lib/                catalog (search + public projection), assistant + llm, subscriptions,
                      revenue, upi (QR), cards (SVG), agreement (EN/HI), crypto, auth, dates (IST)
  routes/             auth, public, member (/api/me), applications, lister, admin, adminCatalog, adminFinance
public/
  css/base.css        the design system: tokens, components, shell, bottom bar
  js/                 ui, api, shell (sidebar + router), components, ai, voice, pwa, site
  js/pages/           one entry per page: landing, explore, service, auth, app, lister, admin, …
docs/FRONTEND.md      conventions for anyone adding a page
test/                 e2e.mjs (API), ui.mjs (browser)
```
