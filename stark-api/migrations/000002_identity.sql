-- +goose Up
-- ============================================================
-- STARK IDENTITY — account uniqueness & multi-device login
--
-- Rule: ONE email → ONE account, ONE phone → ONE account (§2).
-- Uniqueness is enforced HERE, at the database level, on the
-- NORMALIZED values — application checks are only a courtesy.
-- ============================================================

/* ---------------- users: normalized identity ---------------- */

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_normalized TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_normalized TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Backfill from legacy values: email lowercased+trimmed; phone
-- canonicalized to +234XXXXXXXXXX (accepts 0…, 234…, +234…).
UPDATE users SET email_normalized = lower(btrim(email)) WHERE email_normalized IS NULL;

UPDATE users SET phone_normalized =
  CASE
    WHEN regexp_replace(COALESCE(phone, ''), '\D', '', 'g') ~ '^0\d{10}$'
      THEN '+234' || substring(regexp_replace(phone, '\D', '', 'g') FROM 2)
    WHEN regexp_replace(COALESCE(phone, ''), '\D', '', 'g') ~ '^234\d{10}$'
      THEN '+' || regexp_replace(phone, '\D', '', 'g')
    WHEN regexp_replace(COALESCE(phone, ''), '\D', '', 'g') ~ '^\d{10}$'
      THEN '+234' || regexp_replace(phone, '\D', '', 'g')
    ELSE NULL
  END
WHERE phone_normalized IS NULL;

ALTER TABLE users ALTER COLUMN email_normalized SET NOT NULL;
ALTER TABLE users ALTER COLUMN phone_normalized SET NOT NULL;

-- The final authority on identity (§13). Duplicate inserts — including
-- simultaneous racing registrations — fail here with SQLSTATE 23505.
DROP INDEX IF EXISTS uq_users_email;
CREATE UNIQUE INDEX uq_users_email_norm ON users (email_normalized);
CREATE UNIQUE INDEX uq_users_phone_norm ON users (phone_normalized);
CREATE UNIQUE INDEX uq_users_username   ON users (username) WHERE username IS NOT NULL;

-- full_name is deliberately NOT unique: two different people may share a name (§4).

-- Account states (§26): frozen/suspended block login; closed is terminal.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('pending_verification', 'active', 'frozen', 'suspended', 'closed'));

/* ---------------- devices: multi-device support ---------------- */

ALTER TABLE devices ADD COLUMN IF NOT EXISTS fcm_token   TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_model TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS os_version  TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS app_version TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS is_trusted  BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices (device_id);
CREATE INDEX IF NOT EXISTS idx_devices_fcm       ON devices (fcm_token) WHERE fcm_token IS NOT NULL;

/* ---------------- sessions: last-use tracking ---------------- */

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

/* ---------------- audit event coverage ---------------- */
-- security_events.kind stays free-form TEXT; the identity module writes:
--   account_created · login_success · login_failed · new_device_login
--   logout · session_revoked · password_changed · pin_changed · pin_reset
--   account_frozen · account_unfrozen
CREATE INDEX IF NOT EXISTS idx_security_kind ON security_events (kind, created_at DESC);

-- +goose Down
DROP INDEX IF EXISTS idx_security_kind;
ALTER TABLE sessions DROP COLUMN IF EXISTS last_used_at;
DROP INDEX IF EXISTS idx_devices_fcm;
DROP INDEX IF EXISTS idx_devices_device_id;
ALTER TABLE devices DROP COLUMN IF EXISTS fcm_token,
                    DROP COLUMN IF EXISTS device_model,
                    DROP COLUMN IF EXISTS os_version,
                    DROP COLUMN IF EXISTS app_version,
                    DROP COLUMN IF EXISTS is_active,
                    DROP COLUMN IF EXISTS is_trusted;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('pending_verification', 'active', 'frozen', 'suspended'));
DROP INDEX IF EXISTS uq_users_username;
DROP INDEX IF EXISTS uq_users_phone_norm;
DROP INDEX IF EXISTS uq_users_email_norm;
CREATE UNIQUE INDEX uq_users_email ON users (lower(email));
ALTER TABLE users DROP COLUMN IF EXISTS email_normalized,
                  DROP COLUMN IF EXISTS phone_normalized,
                  DROP COLUMN IF EXISTS username,
                  DROP COLUMN IF EXISTS last_login_at;
