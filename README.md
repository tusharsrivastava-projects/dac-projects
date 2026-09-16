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
`ADMIN_PASSWORD` in `.env` control what `npm run seed` creates, and the server
warns on every boot while the repo default is still in place.

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

**Storage, and why it matters.** Render's free plan has no persistent disk. The
database and every uploaded recording sit on an ephemeral filesystem and are
wiped on each deploy and restart. The app re-seeds itself on boot, so the link
always works and the sample roles come back — fine for a demo, not fine once
real candidates are recording answers.

Before a real hiring round, open `render.yaml` and make three changes: switch
`plan: free` to `plan: starter`, uncomment the `disk:` block, and uncomment the
`DATA_DIR` variable. Disks require a paid instance.

## Testing

```bash
npm test
```

Boots the server against a throwaway database and walks a candidate from registration
through to an accepted offer — applying, the locked interview, audio upload and
validation, submission, scoring, approval, the offer link, plus the access-control
checks that keep one candidate out of another's application and audio.

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
  lib/                auth, validation, mail, offer-letter rendering, stage machine
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
test/                 end-to-end suite
data/                 sqlite file + uploaded recordings (gitignored)
```

**Pipeline.** An application's `stage` is the single source of truth, and legal moves
live in `server/lib/stages.js` — the API refuses anything else, so you cannot skip a
candidate from *Applied* straight to *Offer sent*.

**Audio.** Recorded with `MediaRecorder`, stored on disk with only its filename in the
database, and served back through a route that checks ownership on every request.
Range requests are supported, so reviewers can scrub.

**Data you cannot lose by accident.** Deleting a role that has applications closes it
instead. Deleting a question that has answers retires it instead. Nobody's recording
disappears because someone tidied up the board.

## Notes before production

- Put it behind HTTPS and set `COOKIE_SECURE=true`.
- SQLite is fine for a cell-sized hiring round. Swap the driver in `server/db/` if you
  outgrow it.
- Recordings sit on local disk. Mount a volume, or move `uploadDir` to object storage.
- Add rate limiting in front of `/api/auth/login` if this faces the open internet.

---

DAC — DGU AI Cell · DBS Global University, Dehradun
