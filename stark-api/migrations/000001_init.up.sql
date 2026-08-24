-- +goose Up
-- ============================================================
-- STARK TELECOMMUNICATION — PostgreSQL schema (initial)
-- Money is stored as BIGINT kobo. Ledger entries are immutable.
-- Managed by Goose:  goose -dir migrations postgres "$DB_URL" up
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

/* ---------------- identity ---------------- */

CREATE TABLE users (
  id              UUID PRIMARY KEY,
  email           CITEXT,
  phone           TEXT NOT NULL,
  password_hash   TEXT NOT NULL,              -- argon2id, never plaintext
  status          TEXT NOT NULL DEFAULT 'pending_verification'
                  CHECK (status IN ('pending_verification','active','frozen','suspended')),
  phone_verified_at TIMESTAMPTZ,
  email_verified_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_users_email ON users (lower(email));
CREATE INDEX idx_users_phone ON users (phone);

CREATE TABLE profiles (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name          TEXT NOT NULL,
  phone              TEXT NOT NULL,
  referral_code      TEXT NOT NULL,
  referred_by        UUID REFERENCES users(id),
  transaction_pin_hash TEXT,                  -- argon2id, never plaintext
  biometric_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  profile_image_url  TEXT,                    -- object-storage URL, not bytes
  profile_image_key  TEXT,                    -- object-storage key
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_profiles_referral ON profiles (referral_code);

CREATE TABLE devices (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id   TEXT NOT NULL,                  -- privacy-respecting app identifier
  device_name TEXT NOT NULL DEFAULT 'Unknown device',
  platform    TEXT NOT NULL DEFAULT 'android',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id)
);
CREATE INDEX idx_devices_user ON devices (user_id);

CREATE TABLE sessions (
  id           UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    TEXT,
  refresh_jti  TEXT NOT NULL,
  ip_address   INET,
  user_agent   TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_sessions_jti ON sessions (refresh_jti);

/* ---------------- money ---------------- */

CREATE TABLE wallets (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  available_kobo BIGINT NOT NULL DEFAULT 0 CHECK (available_kobo >= 0),
  reserved_kobo  BIGINT NOT NULL DEFAULT 0 CHECK (reserved_kobo >= 0),
  currency       TEXT NOT NULL DEFAULT 'NGN',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_accounts (
  id       UUID PRIMARY KEY,
  user_id  UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL = system account
  kind     TEXT NOT NULL CHECK (kind IN
           ('WALLET','WALLET_RESERVE','CASHBACK','REWARDS','SETTLEMENT','PAYSTACK_CLEARING','FEE')),
  currency TEXT NOT NULL DEFAULT 'NGN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_accounts_user_kind ON ledger_accounts (user_id, kind);

-- Immutable double-entry ledger. No UPDATEs ever — corrections are
-- new REVERSAL postings (enforced by revoking UPDATE/DELETE in prod).
CREATE TABLE ledger_entries (
  id              UUID PRIMARY KEY,
  posting_id      UUID NOT NULL,               -- groups balanced legs
  user_id         UUID REFERENCES users(id),
  account_kind    TEXT NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount_kobo     BIGINT NOT NULL CHECK (amount_kobo > 0),
  transaction_id  UUID,
  idempotency_key TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_ledger_idem ON ledger_entries (posting_id, account_kind, direction);
CREATE INDEX idx_ledger_user_time ON ledger_entries (user_id, created_at DESC);
CREATE INDEX idx_ledger_tx ON ledger_entries (transaction_id);

/* ---------------- transactions ---------------- */

CREATE TABLE transactions (
  id               UUID PRIMARY KEY,
  ref              TEXT NOT NULL,              -- STK-YYYYMMDD-XXXXXXXX
  user_id          UUID NOT NULL REFERENCES users(id),
  service          TEXT NOT NULL,              -- airtime|data|cable|electricity|funding|...
  network          TEXT NOT NULL DEFAULT '',
  account          TEXT NOT NULL DEFAULT '',   -- phone / IUC / meter
  amount_kobo      BIGINT NOT NULL CHECK (amount_kobo > 0),
  fee_kobo         BIGINT NOT NULL DEFAULT 0,
  total_kobo       BIGINT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','PROCESSING','SUCCESSFUL','FAILED','REVERSED','REFUNDED','CANCELLED')),
  provider         TEXT,
  provider_ref     TEXT,
  token            TEXT,                       -- e.g. electricity token from provider
  failure_reason   TEXT,
  idempotency_key  TEXT NOT NULL,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_tx_ref ON transactions (ref);
CREATE UNIQUE INDEX uq_tx_idem ON transactions (user_id, idempotency_key);
CREATE INDEX idx_tx_user_time ON transactions (user_id, created_at DESC);
CREATE INDEX idx_tx_status ON transactions (status) WHERE status = 'PROCESSING';

CREATE TABLE transaction_items (
  id             UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,                -- serial|pin|sms_unit|gift_code
  label          TEXT NOT NULL,
  value          TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* ---------------- payments ---------------- */

CREATE TABLE payments (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id),
  gateway     TEXT NOT NULL DEFAULT 'paystack',
  reference   TEXT NOT NULL,
  amount_kobo BIGINT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','successful','failed','refunded')),
  verified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_payments_ref ON payments (gateway, reference);

CREATE TABLE payment_webhooks (
  id         UUID PRIMARY KEY,
  gateway    TEXT NOT NULL,
  reference  TEXT NOT NULL,
  payload    JSONB NOT NULL,
  signature_ok BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_webhook_ref ON payment_webhooks (gateway, reference);

/* ---------------- providers / VTU ---------------- */

CREATE TABLE providers (
  id         UUID PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  base_url   TEXT NOT NULL,
  priority   INT NOT NULL DEFAULT 1,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  healthy    BOOLEAN NOT NULL DEFAULT TRUE,
  latency_ms INT,
  balance_kobo BIGINT,
  failures_24h INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE provider_products (
  plan_id    TEXT PRIMARY KEY,
  provider_id UUID REFERENCES providers(id),
  kind       TEXT NOT NULL,                    -- data|cable|electricity|exam|gift
  network    TEXT NOT NULL DEFAULT '',
  label      TEXT NOT NULL,
  amount_kobo BIGINT NOT NULL,
  validity   TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_kind_network ON provider_products (kind, network) WHERE active;

CREATE TABLE provider_transactions (
  id            UUID PRIMARY KEY,
  provider_id   UUID NOT NULL REFERENCES providers(id),
  transaction_id UUID REFERENCES transactions(id),
  provider_ref  TEXT,
  request_body  JSONB,
  response_body JSONB,
  status        TEXT NOT NULL DEFAULT 'sent',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* service detail tables */
CREATE TABLE airtime_transactions    (transaction_id UUID PRIMARY KEY REFERENCES transactions(id), phone TEXT NOT NULL, network TEXT NOT NULL);
CREATE TABLE data_transactions       (transaction_id UUID PRIMARY KEY REFERENCES transactions(id), plan_id TEXT NOT NULL, phone TEXT NOT NULL, network TEXT NOT NULL);
CREATE TABLE cable_transactions      (transaction_id UUID PRIMARY KEY REFERENCES transactions(id), provider_slug TEXT NOT NULL, iuc TEXT NOT NULL, package TEXT NOT NULL, customer_name TEXT NOT NULL);
CREATE TABLE electricity_transactions(transaction_id UUID PRIMARY KEY REFERENCES transactions(id), disco TEXT NOT NULL, meter TEXT NOT NULL, meter_type TEXT NOT NULL, token TEXT);

/* ---------------- user features ---------------- */

CREATE TABLE beneficiaries (
  id         UUID PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                    -- phone|meter|cable
  network    TEXT NOT NULL DEFAULT '',
  identifier TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  favorite   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, identifier)
);

CREATE TABLE subscriptions (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id     TEXT NOT NULL REFERENCES provider_products(plan_id),
  account     TEXT NOT NULL,
  auto_renew  BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at  TIMESTAMPTZ NOT NULL,
  renewed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subs_renew ON subscriptions (auto_renew, expires_at);

CREATE TABLE referrals (
  id           UUID PRIMARY KEY,
  referrer_id  UUID NOT NULL REFERENCES users(id),
  referred_id  UUID NOT NULL UNIQUE REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','qualified','rejected')),
  reward_kobo  BIGINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rewards (
  id         UUID PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points     INT NOT NULL,
  source     TEXT NOT NULL,                    -- transaction|referral|campaign|redemption
  reference  TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rewards_user ON rewards (user_id, created_at DESC);

CREATE TABLE cashback_entries (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  source_tx   UUID REFERENCES transactions(id),
  campaign    TEXT,
  status      TEXT NOT NULL DEFAULT 'earned' CHECK (status IN ('earned','claimed','expired')),
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE promotions (
  id         UUID PRIMARY KEY,
  title      TEXT NOT NULL,
  subtitle   TEXT NOT NULL DEFAULT '',
  service    TEXT,
  kind       TEXT NOT NULL DEFAULT 'cashback', -- discount|cashback|banner
  value_bps  INT NOT NULL DEFAULT 0,           -- basis points
  starts_at  TIMESTAMPTZ NOT NULL,
  ends_at    TIMESTAMPTZ NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE notifications (
  id       UUID PRIMARY KEY,
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL DEFAULT 'system',
  title    TEXT NOT NULL,
  body     TEXT NOT NULL,
  read_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_user ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE support_tickets (
  id         UUID PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id),
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UNDER_REVIEW','RESOLVED','CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE disputes (
  id             UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  user_id        UUID NOT NULL REFERENCES users(id),
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'OPEN'
                 CHECK (status IN ('OPEN','UNDER_REVIEW','WAITING_PROVIDER','RESOLVED','REJECTED','REFUNDED')),
  resolution     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);

/* ---------------- security ---------------- */

CREATE TABLE fraud_events (
  id       UUID PRIMARY KEY,
  user_id  UUID REFERENCES users(id),
  kind     TEXT NOT NULL,                      -- rapid_transactions|new_device|pin_failures|...
  risk     TEXT NOT NULL CHECK (risk IN ('LOW','MEDIUM','HIGH')),
  detail   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE security_events (
  id       UUID PRIMARY KEY,
  user_id  UUID NOT NULL REFERENCES users(id),
  kind     TEXT NOT NULL,                      -- login|pin_change|account_freeze|photo_upload|...
  detail   TEXT NOT NULL DEFAULT '',
  ip       INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_security_user ON security_events (user_id, created_at DESC);

CREATE TABLE audit_logs (
  id         UUID PRIMARY KEY,
  actor_user UUID REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  before     JSONB,
  after      JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id         UUID PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  key_hash   TEXT NOT NULL,                    -- sha256 of the key, raw shown once
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* ---------------- updated_at trigger ---------------- */

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_wallets_updated  BEFORE UPDATE ON wallets  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_tx_updated       BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

/* ---------------- seeds ---------------- */

-- System settlement + clearing accounts (user_id NULL).
INSERT INTO ledger_accounts (id, user_id, kind, currency) VALUES
  (gen_random_uuid(), NULL, 'SETTLEMENT', 'NGN'),
  (gen_random_uuid(), NULL, 'PAYSTACK_CLEARING', 'NGN'),
  (gen_random_uuid(), NULL, 'FEE', 'NGN');

-- +goose Down
-- Rename this file to 000001_init.sql for Goose's single-file convention.
DROP FUNCTION IF EXISTS touch_updated_at() CASCADE;
DROP TABLE IF EXISTS api_keys, audit_logs, security_events, fraud_events,
  disputes, support_tickets, notifications, promotions, cashback_entries,
  rewards, referrals, subscriptions, beneficiaries,
  electricity_transactions, cable_transactions, data_transactions,
  airtime_transactions, provider_transactions, provider_products, providers,
  payment_webhooks, payments, transaction_items, transactions,
  ledger_entries, ledger_accounts, wallets, sessions, devices,
  profiles, users CASCADE;
