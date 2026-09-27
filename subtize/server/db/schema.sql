-- Subtize.ai schema. Idempotent: every statement is safe to run on each boot.
-- Money is always stored in paise (INTEGER) so discounts and the platform
-- commission never pick up floating-point pennies.

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,
  public_id       TEXT NOT NULL UNIQUE,              -- USR-7F3A21, what support staff quote
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  phone           TEXT,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'lister', 'admin')),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive', 'suspended', 'banned')),
  status_reason   TEXT,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  avatar_path     TEXT,
  address         TEXT,
  city            TEXT,
  preferred_area  TEXT,
  pref_lat        REAL,
  pref_lng        REAL,
  upi_id          TEXT,                              -- refunds / receiving details
  payment_note    TEXT,
  referral_code   TEXT UNIQUE,
  referred_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notify_email    INTEGER NOT NULL DEFAULT 1,
  notify_expiry   INTEGER NOT NULL DEFAULT 1,
  voice_enabled   INTEGER NOT NULL DEFAULT 1,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,                     -- sha256 of the cookie value
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent   TEXT,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS otps (
  id           INTEGER PRIMARY KEY,
  email        TEXT NOT NULL,
  purpose      TEXT NOT NULL CHECK (purpose IN ('verify', 'reset', 'login')),
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_otps_email ON otps (email, purpose);

CREATE TABLE IF NOT EXISTS categories (
  id     INTEGER PRIMARY KEY,
  slug   TEXT NOT NULL UNIQUE,
  name   TEXT NOT NULL,
  icon   TEXT NOT NULL DEFAULT 'grid',
  sort   INTEGER NOT NULL DEFAULT 0
);

-- Known neighbourhoods. Lets "near Rajpur Road" resolve to coordinates without
-- a geocoding API, and gives the profile a sensible location picker.
CREATE TABLE IF NOT EXISTS locations (
  id    INTEGER PRIMARY KEY,
  area  TEXT NOT NULL,
  city  TEXT NOT NULL,
  lat   REAL NOT NULL,
  lng   REAL NOT NULL,
  UNIQUE (area, city)
);

CREATE TABLE IF NOT EXISTS services (
  id                 INTEGER PRIMARY KEY,
  public_id          TEXT NOT NULL UNIQUE,           -- SVC-4821
  slug               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  category_id        INTEGER NOT NULL REFERENCES categories(id),
  short_description  TEXT NOT NULL,
  description        TEXT NOT NULL,
  area               TEXT NOT NULL,
  city               TEXT NOT NULL,
  lat                REAL,
  lng                REAL,
  service_type       TEXT NOT NULL DEFAULT 'in_person'
                     CHECK (service_type IN ('in_person', 'doorstep', 'online')),
  monthly_price      INTEGER NOT NULL CHECK (monthly_price > 0),
  plan_months        TEXT NOT NULL DEFAULT '1',      -- CSV of offered durations, e.g. '1,3,6'
  available_days     TEXT NOT NULL DEFAULT 'mon,tue,wed,thu,fri,sat',
  hours              TEXT,
  usage_allowed      INTEGER,                        -- NULL = unlimited within the period
  usage_unit         TEXT NOT NULL DEFAULT 'visits',
  usage_restrictions TEXT,
  service_rules      TEXT,
  max_subscribers    INTEGER,
  coupons_enabled    INTEGER NOT NULL DEFAULT 1,
  -- Official Subtize.ai collection account. Never the provider's own UPI.
  payment_upi_id     TEXT,
  payment_payee      TEXT,
  payment_qr_path    TEXT,                           -- optional uploaded official QR image
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'pending_review', 'active', 'inactive')),
  -- Internal only. Never serialised for explorers.
  lister_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  provider_name      TEXT,
  provider_contact   TEXT,
  provider_notes     TEXT,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_services_status ON services (status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_services_lister ON services (lister_id);

CREATE TABLE IF NOT EXISTS service_images (
  id          INTEGER PRIMARY KEY,
  service_id  INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coupons (
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description     TEXT,
  service_id      INTEGER REFERENCES services(id) ON DELETE CASCADE,  -- NULL = every service
  discount_type   TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value  INTEGER NOT NULL CHECK (discount_value > 0),        -- percent, or paise
  max_discount    INTEGER,                                            -- paise cap for percent coupons
  min_value       INTEGER NOT NULL DEFAULT 0,                         -- paise
  starts_on       TEXT NOT NULL,
  expires_on      TEXT NOT NULL,
  usage_limit     INTEGER,                                            -- NULL = unlimited
  per_user_limit  INTEGER NOT NULL DEFAULT 1,
  is_active       INTEGER NOT NULL DEFAULT 1,
  is_public       INTEGER NOT NULL DEFAULT 1,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id             INTEGER PRIMARY KEY,
  public_id      TEXT NOT NULL UNIQUE,               -- SUB-2026-8F21C0
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id     INTEGER NOT NULL REFERENCES services(id),
  months         INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'pending_payment'
                 CHECK (status IN ('pending_payment', 'pending_verification', 'verified',
                                   'active', 'expired', 'cancelled', 'rejected')),
  start_date     TEXT,
  end_date       TEXT,
  activated_at   TEXT,
  activated_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  usage_allowed  INTEGER,                            -- snapshot of the policy at purchase
  usage_unit     TEXT,
  card_code      TEXT UNIQUE,                        -- random, printed as the card's QR
  cancelled_at   TEXT,
  cancelled_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason  TEXT,
  excluded       INTEGER NOT NULL DEFAULT 0,
  reminded_at    TEXT,                               -- expiry reminder sent
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_subs_service ON subscriptions (service_id, status);

CREATE TABLE IF NOT EXISTS payments (
  id                INTEGER PRIMARY KEY,
  public_id         TEXT NOT NULL UNIQUE,            -- PAY-2026-19C0AA
  subscription_id   INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id        INTEGER NOT NULL REFERENCES services(id),
  amount            INTEGER NOT NULL,                -- monthly price x months
  coupon_id         INTEGER REFERENCES coupons(id) ON DELETE SET NULL,
  coupon_code       TEXT,
  discount          INTEGER NOT NULL DEFAULT 0,
  final_amount      INTEGER NOT NULL,
  upi_ref           TEXT NOT NULL,                   -- the note we put in the UPI intent
  payee_vpa         TEXT NOT NULL,                   -- which official account the QR pointed at
  qr_payload        TEXT NOT NULL,
  upi_txn_id        TEXT UNIQUE,
  submitted_at      TEXT,
  status            TEXT NOT NULL DEFAULT 'awaiting_payment'
                    CHECK (status IN ('awaiting_payment', 'pending', 'verified', 'rejected')),
  verified_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_at       TEXT,
  rejection_reason  TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_service ON payments (service_id, status);

CREATE TABLE IF NOT EXISTS usage_logs (
  id               INTEGER PRIMARY KEY,
  subscription_id  INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  units            INTEGER NOT NULL DEFAULT 1,
  note             TEXT,
  source           TEXT NOT NULL DEFAULT 'lister' CHECK (source IN ('lister', 'admin')),
  logged_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  logged_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_sub ON usage_logs (subscription_id);

CREATE TABLE IF NOT EXISTS user_exclusions (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id  INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, service_id)
);

CREATE TABLE IF NOT EXISTS lister_applications (
  id                     INTEGER PRIMARY KEY,
  public_id              TEXT NOT NULL UNIQUE,       -- APP-2026-0007
  user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  applicant_name         TEXT NOT NULL,
  business_name          TEXT NOT NULL,
  email                  TEXT NOT NULL,
  phone                  TEXT NOT NULL,
  business_address       TEXT NOT NULL,
  city                   TEXT NOT NULL,
  category_id            INTEGER REFERENCES categories(id),
  service_description    TEXT NOT NULL,
  gov_id_type            TEXT NOT NULL,              -- GSTIN, Udyam, PAN ...
  gov_id_number_enc      TEXT NOT NULL,              -- AES-GCM, see lib/crypto.js
  address_proof_type     TEXT NOT NULL,
  address_proof_id_enc   TEXT NOT NULL,
  bank_account_name      TEXT NOT NULL,
  bank_account_no_enc    TEXT NOT NULL,
  bank_ifsc              TEXT NOT NULL,
  bank_name              TEXT,
  settlement_upi_enc     TEXT,
  agreement_ack          INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'applied'
                         CHECK (status IN ('applied', 'under_review', 'verification_required',
                                           'approved', 'rejected', 'suspended')),
  documents_verified     INTEGER NOT NULL DEFAULT 0,
  address_verified       INTEGER NOT NULL DEFAULT 0,
  correction_note        TEXT,
  admin_note             TEXT,
  verification_id        TEXT UNIQUE,                -- SUBV-2026-3F9A, issued on approval
  reviewed_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at            TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_apps_user ON lister_applications (user_id);

CREATE TABLE IF NOT EXISTS application_documents (
  id              INTEGER PRIMARY KEY,
  application_id  INTEGER NOT NULL REFERENCES lister_applications(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('address_proof', 'id_proof', 'business_doc', 'payment_qr')),
  path            TEXT NOT NULL,
  original_name   TEXT NOT NULL,
  mime            TEXT NOT NULL,
  size            INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agreements (
  id                  INTEGER PRIMARY KEY,
  public_id           TEXT NOT NULL UNIQUE,          -- AGR-2026-0007
  lister_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id      INTEGER REFERENCES lister_applications(id) ON DELETE SET NULL,
  verification_id     TEXT NOT NULL,
  commission_percent  INTEGER NOT NULL DEFAULT 20,
  version             TEXT NOT NULL DEFAULT '2026.1',
  status              TEXT NOT NULL DEFAULT 'pending_lister'
                      CHECK (status IN ('pending_lister', 'pending_admin', 'active', 'terminated')),
  lister_signed_name  TEXT,
  lister_signature    TEXT,                          -- PNG data URL from the signature pad
  lister_signed_at    TEXT,
  lister_signed_ip    TEXT,
  admin_signed_name   TEXT,
  admin_signed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  admin_signed_at     TEXT,
  terminated_at       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agreements_lister ON agreements (lister_id, status);

-- Financial fields a lister may ask for but never set directly.
CREATE TABLE IF NOT EXISTS change_requests (
  id              INTEGER PRIMARY KEY,
  service_id      INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  lister_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field           TEXT NOT NULL CHECK (field IN ('monthly_price', 'plan_months', 'payment_qr', 'settlement', 'other')),
  current_value   TEXT,
  proposed_value  TEXT NOT NULL,
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at      TEXT,
  decision_note   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settlements (
  id                  INTEGER PRIMARY KEY,
  lister_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month               TEXT NOT NULL,                 -- YYYY-MM
  gross               INTEGER NOT NULL,
  commission          INTEGER NOT NULL,
  payable             INTEGER NOT NULL,
  commission_percent  INTEGER NOT NULL,
  payments_count      INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'paid', 'on_hold')),
  reference           TEXT,
  paid_at             TEXT,
  updated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (lister_id, month)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  read_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read_at);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id          INTEGER PRIMARY KEY,
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body_text   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued',
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at     TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER,
  actor_name  TEXT,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log (entity, entity_id);
