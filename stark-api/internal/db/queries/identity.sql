-- STARK identity queries — compiled to type-safe Go by SQLC.
-- Uniqueness is guaranteed by uq_users_email_norm / uq_users_phone_norm;
-- these queries give fast, friendly pre-checks and admin lookups.

-- name: FindUserByEmailNorm :one
SELECT id, status, email_normalized, phone_normalized, created_at, last_login_at
FROM users
WHERE email_normalized = $1;

-- name: FindUserByPhoneNorm :one
SELECT id, status, email_normalized, phone_normalized, created_at, last_login_at
FROM users
WHERE phone_normalized = $1;

-- name: FindUserByIdentifier :one
-- Login accepts email OR phone (§15).
SELECT id, password_hash, status
FROM users
WHERE email_normalized = $1 OR phone_normalized = $2
LIMIT 1;

-- name: InsertUser :exec
-- Duplicate identities fail here with SQLSTATE 23505 even under race (§14).
INSERT INTO users (id, email, email_normalized, phone, phone_normalized, password_hash, status)
VALUES ($1, $2, $3, $4, $5, $6, 'pending_verification');

-- name: UpsertDevice :exec
-- One row per (user, device) — signing in again updates, never duplicates (§17).
INSERT INTO devices (id, user_id, device_id, device_name, platform, device_model, os_version, app_version, fcm_token, is_trusted, last_seen_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
ON CONFLICT (user_id, device_id) DO UPDATE SET
  last_seen_at = now(),
  fcm_token    = COALESCE(NULLIF($9, ''), devices.fcm_token),
  is_trusted   = devices.is_trusted OR $10;

-- name: CountDeviceForUser :one
-- Used to detect first-time devices (§20).
SELECT COUNT(*)::int
FROM devices
WHERE user_id = $1 AND device_id = $2;

-- name: InsertSession :exec
INSERT INTO sessions (id, user_id, device_id, refresh_jti, ip_address, user_agent, expires_at, last_used_at)
VALUES ($1, $2, $3, $4, $5, $6, now() + interval '30 days', now());

-- name: ListUserSessions :many
SELECT s.id, s.device_id, COALESCE(d.device_name, 'Unknown device') AS device_name,
       COALESCE(d.platform, '') AS platform, s.ip_address, s.created_at,
       COALESCE(s.last_used_at, s.created_at) AS last_used_at,
       (s.revoked_at IS NULL) AS is_active
FROM sessions s
LEFT JOIN devices d ON d.device_id = s.device_id AND d.user_id = s.user_id
WHERE s.user_id = $1
ORDER BY s.created_at DESC
LIMIT 50;

-- name: RevokeSession :execrows
-- Ownership is part of the WHERE clause — a caller can only revoke their own (§22).
UPDATE sessions SET revoked_at = now()
WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL;

-- name: TouchLogin :exec
UPDATE users SET last_login_at = now() WHERE id = $1;
