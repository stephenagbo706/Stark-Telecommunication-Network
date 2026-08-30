// Package auth owns identity: registration, login, OTP verification,
// token refresh, transaction PIN, account freeze, devices/sessions and
// the profile photo pipeline (validate → safe object key → storage).
// Passwords and PINs are hashed with Argon2id; plaintext never persists.
package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/argon2"

	"stark-api/internal/platform"
)

type Module struct {
	cfg   platform.Config
	db    *pgxpool.Pool
	rdb   *redis.Client
	log   *slog.Logger
	tokens *platform.TokenService
	store Storage
}

func New(cfg platform.Config, db *pgxpool.Pool, rdb *redis.Client, log *slog.Logger) *Module {
	return &Module{
		cfg:    cfg,
		db:     db,
		rdb:    rdb,
		log:    log.With("module", "auth"),
		tokens: platform.NewTokenService(cfg, rdb),
		store:  NewLocalStorage(cfg.StorageDir), // swap for S3/R2 in production
	}
}

/* ---------------------------- hashing ----------------------------- */

// Argon2id parameters (OWASP recommended baseline).
const (
	argonTime    = 3
	argonMemory  = 64 * 1024
	argonThreads = 2
	argonKeyLen  = 32
	argonSaltLen = 16
)

func hashSecret(secret string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(secret), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory, argonTime, argonThreads, hex.EncodeToString(salt), hex.EncodeToString(key)), nil
}

func verifySecret(secret, encoded string) bool {
	var m, t uint32
	var p uint8
	var saltHex, keyHex string
	_, err := fmt.Sscanf(encoded, "$argon2id$v=19$m=%d,t=%d,p=%d$%s", &m, &t, &p, &saltHex)
	if err != nil {
		return false
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 {
		return false
	}
	keyHex = parts[5]
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return false
	}
	want, err := hex.DecodeString(keyHex)
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(secret), salt, t, m, p, uint32(len(want)))
	if len(got) != len(want) {
		return false
	}
	var diff byte
	for i := range got {
		diff |= got[i] ^ want[i]
	}
	return diff == 0
}

/* ---------------------------- routes ------------------------------ */

func (m *Module) Routes(r *chi.Mux) {
	r.Route("/api/v1/auth", func(r chi.Router) {
		r.Post("/register", m.handleRegister)
		r.Post("/register/v2", m.handleRegister) // same hardened path, API-contract alias (§7–§14)
		r.Post("/login", m.handleLogin)
		r.Post("/login/v2", m.LoginV2) // email-or-phone, multi-device (§15–§20)
		r.Post("/otp/verify", m.handleOTPVerify)
		r.Post("/refresh", m.handleRefresh)
		r.Post("/logout", m.Auth(m.handleLogout))
		// Session management (§22, §28) — ownership enforced server-side.
		r.With(m.Auth).Get("/sessions", m.ListSessions)
		r.With(m.Auth).Delete("/sessions/{session_id}", m.RevokeSession)
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(m.Auth)
			r.Get("/profile", m.handleGetProfile)
			r.Put("/profile", m.handleUpdateProfile)
			r.Post("/profile/photo", m.handleUploadPhoto)
			r.Delete("/profile/photo", m.handleDeletePhoto)
			r.Post("/security/verify-pin", m.handleVerifyPIN)
			r.Put("/security/pin", m.handleChangePIN)
			r.Post("/security/freeze", m.handleFreeze)
			r.Post("/security/unfreeze", m.handleUnfreeze)
			r.Get("/devices", m.handleDevices)
			r.Delete("/devices/others", m.handleLogoutOthers)
			// Push-token binding per device (§28) — upsert, never duplicate.
			r.Post("/devices/fcm-token", m.RegisterFCMToken)
			r.Put("/devices/fcm-token", m.RegisterFCMToken)
		})
	})
}

// Auth is the bearer-token middleware. It puts the user id in context.
func (m *Module) Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		token := strings.TrimPrefix(h, "Bearer ")
		if h == "" || token == h {
			platform.WriteErr(w, r, http.StatusUnauthorized, "unauthenticated", "Sign in to continue.")
			return
		}
		userID, err := m.tokens.VerifyAccess(token)
		if err != nil {
			platform.WriteErr(w, r, http.StatusUnauthorized, "session_expired", "Your session expired. Sign in again.")
			return
		}
		ctx := context.WithValue(r.Context(), ctxUserID, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

type ctxKey string

const ctxUserID ctxKey = "stark_user_id"

func UserID(ctx context.Context) string {
	v, _ := ctx.Value(ctxUserID).(string)
	return v
}

/* -------------------------- registration -------------------------- */

type registerReq struct {
	Name     string `json:"name"`
	FullName string `json:"full_name"`   // API-contract alias (§7)
	Email    string `json:"email"`
	Phone    string `json:"phone"`
	PhoneNum string `json:"phone_number"` // API-contract alias (§7)
	Password string `json:"password"`
	Referral string `json:"referral_code"`
}

// handleRegister is the ONE registration path (served at /register and
// /register/v2). Identity uniqueness is enforced by PostgreSQL; this
// handler only normalizes, pre-checks for friendly errors and maps the
// constraint violation when a race loses (§14).
func (m *Module) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		platform.WriteErr(w, r, 400, "invalid_body", "Check the registration details and try again.")
		return
	}
	req.Name = firstNonEmpty(req.Name, req.FullName)
	req.Phone = firstNonEmpty(req.Phone, req.PhoneNum)
	// §5–§6 — normalize identity BEFORE anything else. The normalized values
	// are what the unique indexes enforce, so every path (register, login,
	// recovery) must agree on them.
	req.Name = strings.TrimSpace(req.Name)
	req.Email = NormalizeEmail(req.Email)
	req.Phone = NormalizePhone(req.Phone)
	if req.Name == "" || !validEmail.MatchString(req.Email) || req.Phone == "" || len(req.Password) < 8 {
		platform.WriteErr(w, r, 422, "validation", "Provide a valid name, email, Nigerian phone number and a password of at least 8 characters.")
		return
	}

	// §9–§14 — friendly pre-check (the unique indexes re-verify inside the
	// transaction, so racing requests still cannot slip through).
	emailOwner, phoneOwner := identityOwners(r.Context(), m.db, req.Email, req.Phone)
	switch {
	case emailOwner != "" && phoneOwner != "" && emailOwner != phoneOwner:
		writeAudit(r.Context(), m.db, emailOwner, "identity_conflict_registration_attempt",
			"Blocked: email and phone belong to different accounts")
		platform.WriteErr(w, r, 409, "IDENTITY_CONFLICT",
			"The email address and phone number cannot be registered together. Contact Stark Support to resolve it.")
		return
	case emailOwner != "":
		writeAudit(r.Context(), m.db, emailOwner, "duplicate_email_registration_attempt",
			"Blocked duplicate registration for "+req.Email)
		platform.WriteErr(w, r, 409, "ACCOUNT_EXISTS",
			"An account with this email already exists. Please sign in.")
		return
	case phoneOwner != "":
		writeAudit(r.Context(), m.db, phoneOwner, "duplicate_phone_registration_attempt",
			"Blocked duplicate registration for "+req.Phone)
		platform.WriteErr(w, r, 409, "PHONE_ALREADY_REGISTERED",
			"This phone number is already registered. Please sign in.")
		return
	}

	hash, err := hashSecret(req.Password)
	if err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't prepare your account. Please retry.")
		return
	}

	userID := uuid.NewString()
	otp := otpCode()

	tx, err := m.db.Begin(r.Context())
	if err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't prepare your account. Please retry.")
		return
	}
	defer tx.Rollback(r.Context())

	// One atomic transaction: user (with NORMALIZED identity) + profile +
	// wallet + ledger accounts. A racing duplicate fails the unique index
	// here with SQLSTATE 23505 and is mapped to the exact API code (§14) —
	// the database is the final authority, never this handler's pre-check.
	if _, err := tx.Exec(r.Context(),
		`INSERT INTO users (id, email, email_normalized, password_hash, phone, phone_normalized, status)
		 VALUES ($1,$2,$3,$4,$5,$6,'pending_verification')`,
		userID, req.Email, req.Email, hash, req.Phone, req.Phone); err != nil {
		if mapUniqueViolation(err, w, r) {
			return // ACCOUNT_EXISTS / PHONE_ALREADY_REGISTERED — no raw DB errors leak (§11)
		}
		platform.WriteErr(w, r, 500, "internal", "We couldn't create your account. Please retry.")
		return
	}
	refCode := "STK" + strings.ToUpper(strings.ReplaceAll(uuid.NewString()[:8], "-", ""))
	if _, err := tx.Exec(r.Context(),
		`INSERT INTO profiles (user_id, full_name, phone, referral_code) VALUES ($1,$2,$3,$4)`,
		userID, req.Name, req.Phone, refCode); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't prepare your profile. Please retry.")
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO wallets (user_id) VALUES ($1)`, userID); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't open your wallet. Please retry.")
		return
	}
	if _, err := tx.Exec(r.Context(),
		`INSERT INTO ledger_accounts (id, user_id, kind, currency)
		 VALUES ($1,$2,'WALLET','NGN'), ($3,$2,'CASHBACK','NGN'), ($4,$2,'REWARDS','NGN')`,
		uuid.NewString(), userID, uuid.NewString(), uuid.NewString()); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't open your ledger. Please retry.")
		return
	}
	// Referral attribution (§8): resolve the referrer by code and record the
	// relationship atomically with account creation. Status starts at
	// REGISTERED — no reward until a qualifying purchase succeeds (§2).
	// Constraints (uq_referrals_referred, no_self_referral) make this safe
	// against duplicates and self-referral; the dup-check blocks accounts
	// that share the referrer's email or phone (§25).
	if code := strings.ToUpper(strings.TrimSpace(req.Referral)); code != "" {
		var referrerID string
		if err := tx.QueryRow(r.Context(),
			`SELECT user_id FROM profiles WHERE referral_code=$1`, code).Scan(&referrerID); err == nil && referrerID != userID {
			var dup bool
			_ = tx.QueryRow(r.Context(),
				`SELECT EXISTS(SELECT 1 FROM users u
				  WHERE u.id=$1 AND (u.email_normalized=$2 OR u.phone_normalized=$3))`,
				referrerID, req.Email, req.Phone).Scan(&dup)
			if !dup {
				if _, err := tx.Exec(r.Context(),
					`INSERT INTO referrals (id, referrer_user_id, referred_user_id, referral_code, status)
					 VALUES ($1,$2,$3,$4,'REGISTERED') ON CONFLICT (referred_user_id) DO NOTHING`,
					uuid.NewString(), referrerID, userID, code); err == nil {
					_, _ = tx.Exec(r.Context(),
						`INSERT INTO referral_events (id, referral_id, event_type, metadata)
						 SELECT $1, r.id, 'REGISTERED', jsonb_build_object('referred_user', $2::text)
						   FROM referrals r WHERE r.referred_user_id=$3`,
						uuid.NewString(), userID, userID)
				}
			}
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't finish creating your account. Please retry.")
		return
	}

	// OTP lives in Redis only — temporary, expiring, rate-limited. Never in Postgres.
	m.rdb.Set(r.Context(), "otp:"+userID, otp, 5*time.Minute)
	m.rdb.Set(r.Context(), "otp:attempts:"+userID, 0, 5*time.Minute)
	writeAudit(r.Context(), m.db, userID, "account_created",
		"Account created for "+req.Email+" ("+req.Phone+")")
	m.log.Info("user registered", "user_id", userID)

	platform.WriteJSON(w, r, 201, map[string]any{
		"user_id":   userID,
		"otp_sent":  true,
		"otp_hint":  otp, // development only — delivered via SMS/FCM in production
		"message":   "Account created. Enter the 6-digit code sent to your phone.",
	})
}

func otpCode() string {
	b := make([]byte, 3)
	_, _ = rand.Read(b)
	n := (int(b[0])<<16 | int(b[1])<<8 | int(b[2])) % 1000000
	return fmt.Sprintf("%06d", n)
}

/* ----------------------------- login ------------------------------ */

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	DeviceID string `json:"device_id"`
	Device   string `json:"device_name"`
	Platform string `json:"platform"`
}

func (m *Module) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		platform.WriteErr(w, r, 400, "invalid_body", "Check your sign-in details and try again.")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	// Account lockout: 5 failures → 15 minute lock (Redis counter).
	lockKey := "lock:" + req.Email
	if locked, _ := m.rdb.Exists(r.Context(), lockKey).Result(); locked > 0 {
		ttl, _ := m.rdb.TTL(r.Context(), lockKey).Result()
		platform.WriteErr(w, r, 423, "account_locked",
			fmt.Sprintf("Too many failed attempts. Your account is temporarily locked for %d minutes.", int(ttl.Minutes())+1))
		return
	}

	var id, hash, status string
	err := m.db.QueryRow(r.Context(),
		`SELECT id, password_hash, status FROM users WHERE email=$1`, req.Email).
		Scan(&id, &hash, &status)
	if err == pgx.ErrNoRows || !verifySecret(req.Password, hash) {
		n, _ := m.rdb.Incr(r.Context(), "fails:"+req.Email).Result()
		m.rdb.Expire(r.Context(), "fails:"+req.Email, 15*time.Minute)
		if n >= 5 {
			m.rdb.Set(r.Context(), lockKey, "1", 15*time.Minute)
			m.rdb.Del(r.Context(), "fails:"+req.Email)
			m.log.Warn("account locked after failed attempts", "email", req.Email)
			platform.WriteErr(w, r, 423, "account_locked", "Too many failed attempts. Account locked for 15 minutes.")
			return
		}
		platform.WriteErr(w, r, 401, "invalid_credentials", "Email or password is incorrect.")
		return
	}
	if status == "frozen" {
		platform.WriteErr(w, r, 403, "account_frozen", "This account is frozen. Contact support to recover it.")
		return
	}
	m.rdb.Del(r.Context(), "fails:"+req.Email)

	pair, err := m.tokens.IssuePair(id)
	if err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't start your session. Please retry.")
		return
	}

	// Register the device + session (device management / suspicious-login feed).
	if req.DeviceID != "" {
		_, _ = m.db.Exec(r.Context(),
			`INSERT INTO devices (id, user_id, device_id, device_name, platform, last_seen_at)
			 VALUES ($1,$2,$3,$4,$5,now())
			 ON CONFLICT (user_id, device_id) DO UPDATE SET last_seen_at = now()`,
			uuid.NewString(), id, req.DeviceID, req.Device, req.Platform)
	}

	m.log.Info("login", "user_id", id, "device", req.Device)
	platform.WriteJSON(w, r, 200, map[string]any{"tokens": pair, "user_id": id, "status": status})
}

/* ------------------------------ OTP ------------------------------- */

type otpReq struct {
	UserID string `json:"user_id"`
	Code   string `json:"code"`
}

func (m *Module) handleOTPVerify(w http.ResponseWriter, r *http.Request) {
	var req otpReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		platform.WriteErr(w, r, 400, "invalid_body", "Check the code and try again.")
		return
	}
	ctx := r.Context()
	attempts, _ := m.rdb.Incr(ctx, "otp:attempts:"+req.UserID).Result()
	if attempts > 5 {
		platform.WriteErr(w, r, 429, "otp_exhausted", "Too many attempts. Request a new code.")
		return
	}
	want, err := m.rdb.Get(ctx, "otp:"+req.UserID).Result()
	if err == redis.Nil || want != req.Code {
		platform.WriteErr(w, r, 400, "otp_invalid", "That code is incorrect or has expired. Request a new one.")
		return
	}
	m.rdb.Del(ctx, "otp:"+req.UserID, "otp:attempts:"+req.UserID)
	if _, err := m.db.Exec(ctx, `UPDATE users SET status='active', phone_verified_at=now() WHERE id=$1`, req.UserID); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't verify your account. Please retry.")
		return
	}
	pair, err := m.tokens.IssuePair(req.UserID)
	if err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't start your session. Please retry.")
		return
	}
	platform.WriteJSON(w, r, 200, map[string]any{"tokens": pair, "message": "Phone verified. Welcome to Stark."})
}

/* --------------------------- refresh/logout ------------------------ */

func (m *Module) handleRefresh(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		platform.WriteErr(w, r, 400, "invalid_body", "Invalid refresh request.")
		return
	}
	pair, err := m.tokens.Rotate(r.Context(), req.RefreshToken)
	if err != nil {
		platform.WriteErr(w, r, 401, "refresh_rejected", "Your session was reset for security. Sign in again.")
		return
	}
	platform.WriteJSON(w, r, 200, map[string]any{"tokens": pair})
}

func (m *Module) handleLogout(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.RefreshToken != "" {
		m.tokens.Revoke(r.Context(), req.RefreshToken)
	}
	platform.WriteJSON(w, r, 200, map[string]string{"message": "Signed out."})
}

/* ----------------------------- profile ---------------------------- */

func (m *Module) handleGetProfile(w http.ResponseWriter, r *http.Request) {
	uid := UserID(r.Context())
	var p struct {
		Name, Email, Phone, RefCode, Status, Photo string
		PinSet                                       bool
	}
	err := m.db.QueryRow(r.Context(),
		`SELECT pr.full_name, u.email, pr.phone, pr.referral_code, u.status,
		        COALESCE(pr.profile_image_url,''), pr.transaction_pin_hash IS NOT NULL
		 FROM users u JOIN profiles pr ON pr.user_id = u.id WHERE u.id=$1`, uid).
		Scan(&p.Name, &p.Email, &p.Phone, &p.RefCode, &p.Status, &p.Photo, &p.PinSet)
	if err != nil {
		platform.WriteErr(w, r, 404, "not_found", "Profile not found.")
		return
	}
	platform.WriteJSON(w, r, 200, map[string]any{
		"user_id": uid, "name": p.Name, "email": p.Email, "phone": p.Phone,
		"referral_code": p.RefCode, "status": p.Status, "profile_image_url": p.Photo,
		"pin_set": p.PinSet,
	})
}

func (m *Module) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	uid := UserID(r.Context())
	var req struct {
		Name  string `json:"name"`
		Phone string `json:"phone"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		platform.WriteErr(w, r, 400, "invalid_body", "Invalid profile update.")
		return
	}
	if _, err := m.db.Exec(r.Context(),
		`UPDATE profiles SET full_name=COALESCE(NULLIF($2,''),full_name),
		                     phone=COALESCE(NULLIF($3,''),phone), updated_at=now()
		 WHERE user_id=$1`, uid, strings.TrimSpace(req.Name), strings.TrimSpace(req.Phone)); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't save your profile. Please retry.")
		return
	}
	platform.WriteJSON(w, r, 200, map[string]string{"message": "Profile updated."})
}

/* ------------------------- profile photo --------------------------- */
// Client picks → validates size → multipart upload. Server re-validates
// MIME by sniffing bytes, enforces a 2 MB cap, generates a safe object
// key and stores via the Storage interface (local FS here; S3/R2 in
// production). Postgres stores the URL/key — never the image bytes.

const maxPhotoBytes = 2 << 20 // 2 MB

var allowedPhotoMIME = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

func (m *Module) handleUploadPhoto(w http.ResponseWriter, r *http.Request) {
	uid := UserID(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, maxPhotoBytes+512)
	if err := r.ParseMultipartForm(maxPhotoBytes); err != nil {
		platform.WriteErr(w, r, 413, "photo_too_large", "Image is too large. Choose an image under 2 MB.")
		return
	}
	file, _, err := r.FormFile("photo")
	if err != nil {
		platform.WriteErr(w, r, 400, "photo_missing", "Attach an image file to upload.")
		return
	}
	defer file.Close()

	// Sniff the real content type — never trust the client's filename.
	head := make([]byte, 512)
	n, _ := file.Read(head)
	mime := http.DetectContentType(head[:n])
	mime = strings.Split(mime, ";")[0]
	ext, ok := allowedPhotoMIME[mime]
	if !ok {
		platform.WriteErr(w, r, 415, "photo_type", "Only JPEG, PNG or WEBP images are allowed.")
		return
	}

	body, err := io.ReadAll(io.LimitReader(file, maxPhotoBytes))
	if err != nil || len(body) == 0 {
		platform.WriteErr(w, r, 413, "photo_too_large", "Image is too large. Choose an image under 2 MB.")
		return
	}

	key := filepath.Join("avatars", uid, uuid.NewString()+ext)
	url, err := m.store.Put(r.Context(), key, body, mime)
	if err != nil {
		m.log.Error("photo storage failed", "user_id", uid, "err", err)
		platform.WriteErr(w, r, 502, "storage_unavailable", "We couldn't store the image right now. Please retry.")
		return
	}
	if _, err := m.db.Exec(r.Context(),
		`UPDATE profiles SET profile_image_url=$2, profile_image_key=$3, updated_at=now() WHERE user_id=$1`,
		uid, url, key); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't save your photo reference. Please retry.")
		return
	}
	m.log.Info("profile photo updated", "user_id", uid, "key", key)
	platform.WriteJSON(w, r, 200, map[string]string{"profile_image_url": url})
}

func (m *Module) handleDeletePhoto(w http.ResponseWriter, r *http.Request) {
	uid := UserID(r.Context())
	var key sql.NullString
	_ = m.db.QueryRow(r.Context(), `SELECT profile_image_key FROM profiles WHERE user_id=$1`, uid).Scan(&key)
	if key.Valid {
		_ = m.store.Delete(r.Context(), key.String)
	}
	if _, err := m.db.Exec(r.Context(),
		`UPDATE profiles SET profile_image_url=NULL, profile_image_key=NULL, updated_at=now() WHERE user_id=$1`, uid); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't remove the photo. Please retry.")
		return
	}
	platform.WriteJSON(w, r, 200, map[string]string{"message": "Photo removed."})
}

/* ------------------------------- PIN ------------------------------ */

type pinReq struct {
	PIN string `json:"pin"`
}

func (m *Module) handleVerifyPIN(w http.ResponseWriter, r *http.Request) {
	uid := UserID(r.Context())
	var req pinReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil || len(req.PIN) != 4 {
		platform.WriteErr(w, r, 400, "pin_format", "Enter your 4-digit transaction PIN.")
		return
	}
	lockKey := "pinlock:" + uid
	if locked, _ := m.rdb.Exists(r.Context(), lockKey).Result(); locked > 0 {
		platform.WriteErr(w, r, 423, "pin_locked", "PIN is temporarily locked after too many attempts. Try again in 10 minutes.")
		return
	}
	var hash sql.NullString
	if err := m.db.QueryRow(r.Context(), `SELECT transaction_pin_hash FROM profiles WHERE user_id=$1`, uid).Scan(&hash); err != nil || !hash.Valid {
		platform.WriteErr(w, r, 404, "pin_not_set", "Set a transaction PIN before making purchases.")
		return
	}
	if !verifySecret(req.PIN, hash.String) {
		n, _ := m.rdb.Incr(r.Context(), "pinfails:"+uid).Result()
		m.rdb.Expire(r.Context(), "pinfails:"+uid, 10*time.Minute)
		if n >= 3 {
			m.rdb.Set(r.Context(), lockKey, "1", 10*time.Minute)
			m.rdb.Del(r.Context(), "pinfails:"+uid)
			m.log.Warn("pin locked", "user_id", uid)
			platform.WriteErr(w, r, 423, "pin_locked", "Too many wrong PIN attempts. PIN locked for 10 minutes.")
			return
		}
		platform.WriteErr(w, r, 401, "pin_wrong", "Incorrect PIN. Check and try again.")
		return
	}
	m.rdb.Del(r.Context(), "pinfails:"+uid)
	platform.WriteJSON(w, r, 200, map[string]string{"message": "PIN verified."})
}

func (m *Module) handleChangePIN(w http.ResponseWriter, r *http.Request) {
	uid := UserID(r.Context())
	var req struct {
		Current string `json:"current_pin"`
		New     string `json:"new_pin"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil || len(req.New) != 4 {
		platform.WriteErr(w, r, 400, "pin_format", "PIN must be exactly 4 digits.")
		return
	}
	hash, err := hashSecret(req.New)
	if err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't update your PIN. Please retry.")
		return
	}
	if _, err := m.db.Exec(r.Context(),
		`UPDATE profiles SET transaction_pin_hash=$2, updated_at=now() WHERE user_id=$1`, uid, hash); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't update your PIN. Please retry.")
		return
	}
	m.log.Info("pin changed", "user_id", uid)
	platform.WriteJSON(w, r, 200, map[string]string{"message": "Transaction PIN updated."})
}

/* --------------------------- freeze / devices ---------------------- */

func (m *Module) handleFreeze(w http.ResponseWriter, r *http.Request) {
	uid := UserID(r.Context())
	if _, err := m.db.Exec(r.Context(), `UPDATE users SET status='frozen' WHERE id=$1`, uid); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't freeze the account. Please retry.")
		return
	}
	_, _ = m.db.Exec(r.Context(),
		`INSERT INTO security_events (id, user_id, kind, detail) VALUES ($1,$2,'account_freeze','User-initiated account freeze')`,
		uuid.NewString(), uid)
	m.log.Warn("account frozen", "user_id", uid)
	platform.WriteJSON(w, r, 200, map[string]string{"message": "Account frozen. All financial operations are blocked until you unfreeze."})
}

func (m *Module) handleUnfreeze(w http.ResponseWriter, r *http.Request) {
	uid := UserID(r.Context())
	if _, err := m.db.Exec(r.Context(), `UPDATE users SET status='active' WHERE id=$1`, uid); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't unfreeze the account. Please retry.")
		return
	}
	platform.WriteJSON(w, r, 200, map[string]string{"message": "Account unfrozen."})
}

func (m *Module) handleDevices(w http.ResponseWriter, r *http.Request) {
	uid := UserID(r.Context())
	rows, err := m.db.Query(r.Context(),
		`SELECT device_id, device_name, platform, last_seen_at FROM devices WHERE user_id=$1 ORDER BY last_seen_at DESC LIMIT 20`, uid)
	if err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't load your devices. Please retry.")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, plat string
		var seen time.Time
		if err := rows.Scan(&id, &name, &plat, &seen); err == nil {
			out = append(out, map[string]any{"device_id": id, "name": name, "platform": plat, "last_seen": seen})
		}
	}
	platform.WriteJSON(w, r, 200, out)
}

func (m *Module) handleLogoutOthers(w http.ResponseWriter, r *http.Request) {
	uid := UserID(r.Context())
	current := r.Header.Get("X-Device-ID")
	if _, err := m.db.Exec(r.Context(),
		`DELETE FROM devices WHERE user_id=$1 AND device_id <> $2`, uid, current); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't sign out other devices. Please retry.")
		return
	}
	platform.WriteJSON(w, r, 200, map[string]string{"message": "All other devices signed out."})
}

/* --------------------------- storage ------------------------------- */

type Storage interface {
	Put(ctx context.Context, key string, data []byte, contentType string) (url string, err error)
	Delete(ctx context.Context, key string) error
}

// LocalStorage is the development Storage implementation. In production
// implement the same interface against S3/Cloudflare R2/Supabase Storage
// with private credentials held server-side only.
type LocalStorage struct{ dir string }

func NewLocalStorage(dir string) *LocalStorage { _ = os.MkdirAll(dir, 0o755); return &LocalStorage{dir: dir} }

func (s *LocalStorage) Put(_ context.Context, key string, data []byte, _ string) (string, error) {
	full := filepath.Join(s.dir, filepath.Clean("/"+key))
	if !strings.HasPrefix(full, filepath.Clean(s.dir)+string(os.PathSeparator)) {
		return "", errors.New("unsafe object key")
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(full, data, 0o644); err != nil {
		return "", err
	}
	return "/files/" + filepath.ToSlash(key), nil
}

func (s *LocalStorage) Delete(_ context.Context, key string) error {
	return os.Remove(filepath.Join(s.dir, filepath.Clean("/"+key)))
}
