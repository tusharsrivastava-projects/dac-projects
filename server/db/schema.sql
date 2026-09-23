PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'candidate' CHECK (role IN ('admin', 'candidate')),
  status        TEXT NOT NULL DEFAULT 'active'    CHECK (status IN ('active', 'disabled')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  department      TEXT NOT NULL DEFAULT 'DGU AI Cell',
  location        TEXT NOT NULL DEFAULT 'Dehradun, IN',
  employment_type TEXT NOT NULL DEFAULT 'Internship',
  stipend         TEXT,
  summary         TEXT,
  description     TEXT,
  openings        INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'closed')),
  archived_at     TEXT,
  created_by      INTEGER REFERENCES users (id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- stage is the single source of truth for where an application sits in the pipeline
CREATE TABLE IF NOT EXISTS applications (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id           INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id                 INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  stage                  TEXT NOT NULL DEFAULT 'applied' CHECK (stage IN (
                           'applied', 'screening', 'interview', 'evaluation',
                           'approved', 'rejected', 'offer_sent', 'offer_accepted',
                           'offer_declined', 'withdrawn')),
  headline               TEXT,
  experience             TEXT,
  skills                 TEXT,
  portfolio_url          TEXT,
  resume_url             TEXT,
  cover_note             TEXT,
  score                  REAL,
  admin_notes            TEXT,
  reject_reason          TEXT,
  reviewed_by            INTEGER REFERENCES users (id),
  reviewed_at            TEXT,
  interview_unlocked_at  TEXT,
  interview_submitted_at TEXT,
  drive_folder_id        TEXT,
  drive_folder_link      TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (candidate_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_applications_stage ON applications (stage);
CREATE INDEX IF NOT EXISTS idx_applications_candidate ON applications (candidate_id);

-- job_id NULL means the question is asked for every role
CREATE TABLE IF NOT EXISTS questions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         INTEGER REFERENCES jobs (id) ON DELETE CASCADE,
  prompt         TEXT NOT NULL,
  hint           TEXT,
  think_seconds  INTEGER NOT NULL DEFAULT 30,
  answer_seconds INTEGER NOT NULL DEFAULT 120,
  position       INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  created_by     INTEGER REFERENCES users (id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_questions_job ON questions (job_id, active, position);

CREATE TABLE IF NOT EXISTS answers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id   INTEGER NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  question_id      INTEGER NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  audio_file       TEXT NOT NULL,
  mime_type        TEXT,
  size_bytes       INTEGER,
  duration_seconds REAL,
  transcript       TEXT,
  storage          TEXT NOT NULL DEFAULT 'local',
  drive_file_id    TEXT,
  drive_link       TEXT,
  score            REAL,
  feedback         TEXT,
  evaluated_by     INTEGER REFERENCES users (id),
  evaluated_at     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (application_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_answers_application ON answers (application_id);

CREATE TABLE IF NOT EXISTS offers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id  INTEGER NOT NULL UNIQUE REFERENCES applications (id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,
  position_title  TEXT NOT NULL,
  department      TEXT,
  location        TEXT,
  employment_type TEXT,
  compensation    TEXT,
  start_date      TEXT,
  reporting_to    TEXT,
  expires_on      TEXT,
  extra_terms     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'revoked')),
  issued_by       INTEGER REFERENCES users (id),
  sent_at         TEXT,
  accepted_at     TEXT,
  declined_at     TEXT,
  decline_reason  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email   TEXT NOT NULL,
  to_name    TEXT,
  subject    TEXT NOT NULL,
  body_html  TEXT NOT NULL,
  body_text  TEXT,
  kind       TEXT,
  related_id INTEGER,
  status     TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  provider   TEXT,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at    TEXT
);

CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  actor_name TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log (created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
