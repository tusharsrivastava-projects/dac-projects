<p align="center">
  <img src="public/assets/dac-badge.svg" width="140" alt="DAC — DGU AI Cell">
</p>

<h1 align="center">DAC HRM Platform</h1>

<p align="center">
  Hiring for the DGU AI Cell, end to end — apply, answer the panel in your own voice,<br>
  get reviewed, and pick up an offer letter from a link.
</p>

---

Recruiting at a university cell is mostly chasing: chasing a slot everyone can make,
chasing the email thread the CV was attached to, chasing whoever has the offer template.
This takes that whole loop and puts it in one place.

A candidate signs up, applies to a role, and — once an admin opens the gate — reads the
panel's questions on screen and answers each one by recording audio in the browser. No
call to schedule. The panel listens whenever suits them, scores each answer, and approves
or passes. On approval an admin drafts the offer letter and sends it; the candidate gets
a private link and accepts or declines from there.

## What's in it

**For candidates**
- Sign in / sign out, sidebar dashboard, live stage tracking on every application
- Browse open roles and apply with a short structured form
- Read the questions an admin has fed in, think, then record each answer in-browser
  (think-timer, hard answer limit, live level meter, re-record before you commit)
- Play back every take, review the whole set, submit once
- Read the offer letter and accept or decline

**For admins**
- Separate console behind the same login, with its own sidebar
- Review *all* applications — filter by stage or role, search, sort by score
- Play each recorded answer, score it out of 10, leave feedback; the application
  score is the running average
- Move applications through the pipeline; every move the candidate should know about
  sends an email
- Feed the question bank: general questions asked of everyone, plus role-specific ones
- Draft, edit, send and revoke offer letters
- Mail outbox with full previews, candidate list, and an activity log

**Offer links** carry an unguessable token and need no login, so a candidate can respond
from any device. Accepting or declining notifies every admin.

## Running it

```bash
npm install
npm run seed     # creates the admin, three demo roles and the question bank
npm start        # http://localhost:4000
```

Seeded logins:

| Role      | Email                  | Password         |
|-----------|------------------------|------------------|
| Admin     | `admin@dgu.ac.in`      | `dac-admin-2026` |
| Candidate | `aarav.demo@dgu.ac.in` | `candidate123`   |

Change the admin password before this goes anywhere real — `ADMIN_EMAIL` and
`ADMIN_PASSWORD` control what `npm run seed` creates, and the server warns on
every boot while the repo default is in place or the password is under ten
characters. It never prints the password itself.

**Keep it out of the repository.** Set it as an environment variable — in a
local `.env` (gitignored) or, on Render, under Environment with the value
marked secret. A password committed to git stays in the history after you
delete it, and everyone with repository access can read it. `npm test`
includes a suite that fails if the production password ever appears in a
tracked file, in a log line, or in the database as anything but a bcrypt
hash.

`npm run reset` wipes the database and uploads and reseeds from scratch.

An empty database bootstraps itself on first boot, so a fresh deploy always has
a way in without anyone running the seed by hand. It only fires when there are
no users at all — restarting a live installation never touches your data. Set
`SEED_DEMO_DATA=false` to skip the sample roles, or `AUTO_BOOTSTRAP=false` to
turn it off entirely.

### Recording needs a secure context

Browsers only hand out the microphone over HTTPS or on `localhost`. On a LAN address
like `http://192.168.1.10:4000` the interview screen will say recording is unsupported.
Put it behind TLS (or a tunnel) for anything beyond local testing.

### Mail

With no `SMTP_HOST` set, nothing is actually delivered — every message is written to
the **Mail outbox** in the admin console, previewable in full. The hiring flow still
works start to finish, because an admin can copy the offer link out of the outbox and
send it by hand. Set the `SMTP_*` variables in `.env` to switch on real delivery.

Set `BASE_URL` in production. Offer links are built from it, and getting it wrong means
sending candidates a link to `localhost`.

## Storing recordings in Google Drive

By default interview audio is written to `DATA_DIR/uploads`. Point
`STORAGE_DRIVER` at `drive` instead and each answer is uploaded to a Google
Drive folder you own, laid out so it is worth opening directly:

```
DAC Interview Submissions/
  Machine Learning Intern/
    Ishita Rao — app42/
      Q1 — Walk us through who you are and why the DGU AI Cell interests you.webm
      Q2 — Tell us about a project you finished.webm
```

Each file carries the candidate, the role and the full question in its Drive
description, so the folder stands on its own — you can review submissions there
without going near the admin console. The console still plays every recording
inline, streaming it back through the app so the ownership check holds, and
links out to the candidate's folder next to it.

### Setting it up

```bash
npm run google-auth
```

That walks the consent flow and prints the four values to set. You need an
OAuth client first — the script tells you which four screens in the Google
Cloud console to click through, and it takes about two minutes.

```bash
STORAGE_DRIVER=drive
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
GOOGLE_REFRESH_TOKEN=…
```

Leave `GDRIVE_FOLDER_ID` blank. The app then creates and finds its own folder,
which is the only thing the narrow `drive.file` scope can reach — it can touch
files it created and nothing else in your Drive. To use a folder that already
exists, set `GDRIVE_FOLDER_ID` to its id and re-run the helper with
`--scope drive`, which grants access to your whole Drive.

The server checks Drive at boot and prints the folder it will use, so a wrong
id or an expired token shows up immediately rather than halfway through
somebody's interview. If an upload fails anyway, the recording is kept on local
disk and flagged **on disk only** in the console rather than being lost.

### A trap worth knowing about

Service accounts have no storage quota. Uploading into a folder in a personal
**My Drive** fails with `storageQuotaExceeded` no matter how you share it — the
only accounts that work there are real ones, via the refresh token above. A
service account is fine for a **Shared Drive**, and `GOOGLE_SERVICE_ACCOUNT_JSON`
is there for that case.

## Deploying to Render

A blueprint ships with the repo, so this is mostly clicking:

1. Render dashboard → **New → Blueprint** → pick this repository.
2. It reads `render.yaml`, asks for `ADMIN_EMAIL` (and the SMTP fields, which
   you can leave blank for now), and deploys.
3. Open **Environment** in the dashboard and copy the generated
   `ADMIN_PASSWORD`. That is your admin login — change it under Profile once
   you are in.

You get `https://<name>.onrender.com`. HTTPS is handled for you, which matters:
the audio interview needs a secure context or the browser will not release the
microphone. Offer links are built from Render's own `RENDER_EXTERNAL_URL`, so
they point at the right host without you setting anything.

**Storage.** The blueprint is set up to survive restarts. Recordings go to your
Google Drive (`STORAGE_DRIVER=drive`), and the database sits on a 5GB
persistent disk mounted at `/var/data`, so applications, scores and offers
outlive deploys.

Disks require a paid instance, which is why the plan is `starter` — roughly
$7/mo plus $0.25/GB. To run it free instead, change `plan: starter` to
`plan: free`, delete the `disk:` block and drop the `DATA_DIR` variable.
Recordings still go to Drive, but the database resets on every restart, so
applications and scores are lost. The admin account and sample roles come back
on boot, so the link keeps working — demo only.

## Testing

```bash
npm test
```

Boots the server against a throwaway database and walks a candidate from registration
through to an accepted offer — applying, the locked interview, audio upload and
validation, submission, scoring, approval, the offer link, plus the access-control
checks that keep one candidate out of another's application and audio. It then
runs the Drive suite, which stands in for `fetch` to verify the storage path
without real credentials: token caching, the 401 retry, the folder hierarchy,
the multipart upload, Range pass-through, and the fallback that keeps a
recording when Drive rejects it.

There is a browser-level version of the same walk-through that drives Chromium with a
synthetic microphone, so the recording path gets covered for real. It needs Playwright,
which is deliberately not a default dependency:

```bash
npm i -D playwright && npx playwright install chromium
npm run test:ui
```

Set `SHOT_DIR=/some/dir` to have it drop a screenshot of every step.

## How it is built

No build step and no framework. Node with Express on the back, plain ES modules and
hand-rolled CSS on the front, SQLite on disk.

```
server/
  index.js            express app, static hosting, page routes
  config.js           every env var, with defaults
  db/                 schema.sql, connection, seed
  lib/                auth, validation, mail, offer letters, stage machine,
                      Google auth + Drive client, storage drivers
  middleware/         session attach + guards, error handling
  routes/             auth · jobs · applications · questions · interview · offers · admin
public/
  index.html          landing + sign in / register
  app.html            candidate dashboard shell
  admin.html          admin console shell
  offer.html          public offer letter
  js/                 api client, UI kit, shell + router, recorder, page apps
  css/                design tokens and page styles
  assets/             DAC logo, compact mark, favicon
scripts/              google-auth.js — mints a Drive refresh token
test/                 end-to-end suites (API, browser, Drive)
data/                 sqlite file + uploaded recordings (gitignored)
```

**Pipeline.** An application's `stage` is the single source of truth, and legal moves
live in `server/lib/stages.js` — the API refuses anything else, so you cannot skip a
candidate from *Applied* straight to *Offer sent*.

**Audio.** Recorded with `MediaRecorder`, then handed to a storage driver —
local disk or Google Drive — and served back through a route that checks
ownership on every request. Range requests work either way; for Drive the
client's `Range` header is passed straight through and the 206 mirrored back,
so scrubbing does not mean buffering the whole recording.

**Data you cannot lose by accident.** Deleting a role that has applications closes it
instead. Deleting a question that has answers retires it instead. Nobody's recording
disappears because someone tidied up the board.

## Notes before production

- Put it behind HTTPS and set `COOKIE_SECURE=true`.
- SQLite is fine for a cell-sized hiring round. Swap the driver in `server/db/` if you
  outgrow it.
- Recordings sit on local disk unless `STORAGE_DRIVER=drive` is set. On a host
  without a persistent volume, set it.
- The admin password is never logged, never returned by the API and stored
  only as a bcrypt hash. Rotate it by changing `ADMIN_PASSWORD` and using
  Profile → Password, or by deleting the admin row and reseeding.
- Sign-in, registration and password changes are rate limited in memory. That
  is per-process, so a multi-instance deploy gets one bucket per instance —
  fine for one box, worth moving to a shared store if you scale out.

---

DAC — DGU AI Cell · DBS Global University, Dehradun
