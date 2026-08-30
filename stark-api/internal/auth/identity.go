// Identity — account uniqueness, normalization, sessions & devices.
//
// Core rule (§2): ONE email → ONE account, ONE phone → ONE account.
// Application checks give friendly errors; PostgreSQL unique indexes
// (uq_users_email_norm, uq_users_phone_norm) are the FINAL authority and
// also defeat racing registrations (§14).
//
// Signing in from a new device creates a device + session row — it NEVER
// creates a second user (§16). The immutable user id keeps the wallet,
// ledger, transactions, referrals and history attached to one identity.
package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"stark-api/internal/platform"
)

/* ------------------------- normalization ------------------------- */

var nonDigits = regexp.MustCompile(`\D`)

// NormalizeEmail trims, strips inner whitespace and lowercases (§5).
// "Clark@Example.com" and "clark@example.com" are the same identity.
func NormalizeEmail(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	return strings.Join(strings.Fields(s), "")
}

// NormalizePhone canonicalizes Nigerian numbers to +234XXXXXXXXXX (§6).
// Accepts 08012345678, +2348012345678, 2348012345678, spaced/dashed forms.
// Returns "" when the number cannot be confidently normalized.
func NormalizePhone(raw string) string {
	d := nonDigits.ReplaceAllString(raw, "")
	switch {
	case strings.HasPrefix(d, "00234"):
		d = d[3:]
	case len(d) == 13 && strings.HasPrefix(d, "234"):
		d = d[3:]
	case len(d) == 11 && strings.HasPrefix(d, "0"):
		d = d[1:]
	}
	if len(d) != 10 {
		return ""
	}
	if d[0] != '7' && d[0] != '8' && d[0] != '9' {
		return "" // subscriber numbers start 070/080/081/090/091…
	}
	return "+234" + d
}

// ValidEmail is a pragmatic format check (final validation is server-side).
var validEmail = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`)

/* ----------------------- identity conflict ----------------------- */

// conflict probes the two unique identities BEFORE insert so users get a
// precise, actionable error instead of a generic failure (§9–§12).
// Returns (emailOwnerID, phoneOwnerID).
func identityOwners(ctx context.Context, db *pgxpool.Pool, emailNorm, phoneNorm string) (emailOwner, phoneOwner string) {
	_ = db.QueryRow(ctx,
		`SELECT id FROM users WHERE email_normalized=$1`, emailNorm).Scan(&emailOwner)
	if phoneNorm != "" {
		_ = db.QueryRow(ctx,
			`SELECT id FROM users WHERE phone_normalized=$1`, phoneNorm).Scan(&phoneOwner)
	}
	return emailOwner, phoneOwner
}

// mapUniqueViolation converts a PostgreSQL 23505 race (§14) into the exact
// API error code. Raw database errors are NEVER surfaced to clients.
func mapUniqueViolation(err error, w http.ResponseWriter, r *http.Request) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return false
	}
	switch pgErr.ConstraintName {
	case "uq_users_phone_norm":
		platform.WriteErr(w, r, 409, "PHONE_ALREADY_REGISTERED",
			"This phone number is already registered. Please sign in.")
	default: // uq_users_email_norm (and any other identity index)
		platform.WriteErr(w, r, 409, "ACCOUNT_EXISTS",
			"An account with this email already exists. Please sign in.")
	}
	return true
}

/* --------------------- registration (§7–§14) ---------------------
   Registration lives in auth.go (handleRegister), served by BOTH
   /api/v1/auth/register and /register/v2 — one hardened path: normalize
   identity, pre-check for friendly errors, then let the unique indexes
   (uq_users_email_norm / uq_users_phone_norm) make the final call. */

/* ----------------------- login (§15–§20) ------------------------- */

type loginReqV2 struct {
	Identifier string `json:"identifier"` // email OR phone
	Password   string `json:"password"`
	DeviceID   string `json:"device_id"`
	Device     string `json:"device_name"`
	Platform   string `json:"platform"`
	Model      string `json:"device_model"`
	OSVersion  string `json:"os_version"`
	AppVersion string `json:"app_version"`
	FCMToken   string `json:"fcm_token"`
}

// LoginV2 signs an EXISTING account in — possibly from a brand-new device.
// A new device creates device + session rows, never a new user (§16, §19).
func (m *Module) LoginV2(w http.ResponseWriter, r *http.Request) {
	var req loginReqV2
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		platform.WriteErr(w, r, 400, "invalid_body", "Check your sign-in details and try again.")
		return
	}

	emailNorm := NormalizeEmail(req.Identifier)
	phoneNorm := NormalizePhone(req.Identifier)
	if emailNorm == "" && phoneNorm == "" {
		platform.WriteErr(w, r, 422, "validation", "Enter your email or phone number.")
		return
	}

	var id, hash, status string
	err := m.db.QueryRow(r.Context(),
		`SELECT id, password_hash, status FROM users
		  WHERE email_normalized=$1 OR phone_normalized=$2
		  LIMIT 1`, emailNorm, phoneNorm).Scan(&id, &hash, &status)

	if err == pgx.ErrNoRows || !verifySecret(req.Password, hash) {
		writeAudit(r.Context(), m.db, "", "login_failed", "Unknown identity or wrong password")
		platform.WriteErr(w, r, 401, "invalid_credentials", "Incorrect email/phone or password.")
		return
	}

	// §26 — account state gates authentication.
	switch status {
	case "frozen":
		platform.WriteErr(w, r, 403, "ACCOUNT_FROZEN", "This account is frozen. Contact support to recover it.")
		return
	case "suspended":
		platform.WriteErr(w, r, 403, "ACCOUNT_SUSPENDED", "This account is suspended. Contact support for details.")
		return
	case "closed":
		platform.WriteErr(w, r, 403, "ACCOUNT_CLOSED", "This account is closed.")
		return
	}

	// Multi-device: upsert the device row, detect first-time devices (§20).
	newDevice := false
	if req.DeviceID != "" {
		var existing int
		_ = m.db.QueryRow(r.Context(),
			`SELECT COUNT(*) FROM devices WHERE user_id=$1 AND device_id=$2`, id, req.DeviceID).Scan(&existing)
		newDevice = existing == 0
		_, _ = m.db.Exec(r.Context(),
			`INSERT INTO devices (id, user_id, device_id, device_name, platform, device_model, os_version, app_version, fcm_token, is_trusted, last_seen_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
			 ON CONFLICT (user_id, device_id) DO UPDATE SET
			   last_seen_at=now(), fcm_token=COALESCE(NULLIF($9,''), devices.fcm_token)`,
			uuid.NewString(), id, req.DeviceID, req.Device, req.Platform, req.Model, req.OSVersion, req.AppVersion, req.FCMToken, !newDevice)
	}

	// Issue tokens + a session row (§18).
	pair, err := m.tokens.IssuePair(id)
	if err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't open your session. Please retry.")
		return
	}
	// The refresh token's JTI lives inside the token service (Redis rotation);
	// the session row keeps its own unique identifier for revocation (§18).
	sessionRef := uuid.NewString()
	if _, err := m.db.Exec(r.Context(),
		`INSERT INTO sessions (id, user_id, device_id, refresh_jti, ip_address, user_agent, expires_at, last_used_at)
		 VALUES ($1,$2,$3,$4,$5,$6, now() + interval '30 days', now())`,
		uuid.NewString(), id, req.DeviceID, sessionRef, r.RemoteAddr, r.UserAgent()); err != nil {
		m.log.Warn("session insert failed", "user_id", id, "err", err)
	}

	_, _ = m.db.Exec(r.Context(), `UPDATE users SET last_login_at=now() WHERE id=$1`, id)
	writeAudit(r.Context(), m.db, id, "login_success", fmt.Sprintf("Signed in from %s", req.Device))
	if newDevice {
		writeAudit(r.Context(), m.db, id, "new_device_login", fmt.Sprintf("%s • %s", req.Device, req.Platform))
		// Security notification — NEVER includes secrets (§20).
		_, _ = m.db.Exec(r.Context(),
			`INSERT INTO notifications (id, user_id, kind, title, body)
			 VALUES ($1,$2,'security','New device signed in',
			         $3 || ' signed into your Stark account. If this wasn''t you, freeze the account from Security.')`,
			uuid.NewString(), id, req.Device)
	}

	platform.WriteJSON(w, r, 200, map[string]any{
		"tokens": pair, "user_id": id, "status": status, "new_device": newDevice,
	})
}

/* -------------------- sessions & devices (§22, §28) ------------------- */

// ListSessions returns the caller's sessions. Ownership is enforced by
// filtering on the authenticated user id — never on client input.
func (m *Module) ListSessions(w http.ResponseWriter, r *http.Request) {
	uid := UserID(r.Context())
	rows, err := m.db.Query(r.Context(),
		`SELECT s.id, COALESCE(d.device_name,'Unknown device'), COALESCE(d.platform,''),
		        s.ip_address::text, s.created_at, COALESCE(s.last_used_at, s.created_at),
		        (s.revoked_at IS NULL) AS active
		   FROM sessions s LEFT JOIN devices d ON d.device_id = s.device_id AND d.user_id = s.user_id
		  WHERE s.user_id=$1
		  ORDER BY s.created_at DESC LIMIT 50`, uid)
	if err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't load your sessions. Please retry.")
		return
	}
	defer rows.Close()

	out := []map[string]any{}
	for rows.Next() {
		var id, device, plat, ip string
		var created, lastUsed interface{}
		var active bool
		if err := rows.Scan(&id, &device, &plat, &ip, &created, &lastUsed, &active); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"session_id": id, "device": device, "platform": plat, "ip": ip,
			"created_at": created, "last_used_at": lastUsed, "active": active,
		})
	}
	platform.WriteJSON(w, r, 200, map[string]any{"sessions": out})
}

// RevokeSession revokes ONE session that belongs to the caller (§22).
func (m *Module) RevokeSession(w http.ResponseWriter, r *http.Request) {
	uid := UserID(r.Context())
	sessionID := chi.URLParam(r, "session_id")
	tag, err := m.db.Exec(r.Context(),
		`UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`,
		sessionID, uid)
	if err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't revoke that session. Please retry.")
		return
	}
	if tag.RowsAffected() == 0 {
		platform.WriteErr(w, r, 404, "session_not_found", "That session doesn't belong to this account or is already revoked.")
		return
	}
	writeAudit(r.Context(), m.db, uid, "session_revoked", "Session "+sessionID+" revoked")
	platform.WriteJSON(w, r, 200, map[string]string{"message": "Session revoked."})
}

// RegisterFCMToken binds/updates the push token for the caller's device.
func (m *Module) RegisterFCMToken(w http.ResponseWriter, r *http.Request) {
	uid := UserID(r.Context())
	var req struct {
		DeviceID string `json:"device_id"`
		Token    string `json:"fcm_token"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil || req.Token == "" {
		platform.WriteErr(w, r, 400, "invalid_body", "Provide a valid FCM token.")
		return
	}
	_, _ = m.db.Exec(r.Context(),
		`INSERT INTO devices (id, user_id, device_id, device_name, platform, fcm_token, last_seen_at)
		 VALUES ($1,$2,$3,'This device','mobile',$4,now())
		 ON CONFLICT (user_id, device_id) DO UPDATE SET fcm_token=$4, last_seen_at=now()`,
		uuid.NewString(), uid, req.DeviceID, req.Token)
	platform.WriteJSON(w, r, 200, map[string]string{"message": "Push token registered."})
}

/* --------------------------- helpers --------------------------- */

// writeAudit appends a security event without any secrets (§27).
func writeAudit(ctx context.Context, db *pgxpool.Pool, userID, kind, detail string) {
	if userID == "" {
		return
	}
	_, _ = db.Exec(ctx,
		`INSERT INTO security_events (id, user_id, kind, detail) VALUES ($1,$2,$3,$4)`,
		uuid.NewString(), userID, kind, detail)
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// logRef keeps the linter honest about the logger dependency.
var _ = slog.Default
