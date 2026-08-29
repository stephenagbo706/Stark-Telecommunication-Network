// Package platform contains the technical foundation of stark-api:
// configuration, structured logging, PostgreSQL (pgx), Redis, the HTTP
// middleware stack and the JWT token service. Domain modules never talk
// to infrastructure directly — everything flows through this package.
package platform

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"github.com/jackc/pgx/v5/pgxpool"
)

/* ------------------------------------------------------------------ */
/* Config — every secret comes from the environment, never from code.  */
/* ------------------------------------------------------------------ */

type Config struct {
	Env  string
	Port string

	DatabaseURL string
	RedisURL    string

	JWTAccessSecret  string
	JWTRefreshSecret string

	// Paystack secret key lives ONLY on this backend. Flutter never sees it.
	PaystackSecretKey string
	PaystackBaseURL   string
	// Public key (pk_live_… / pk_test_…) — safe for clients, though Stark's
	// hosted-charge flow initializes server-side and never needs it here.
	PaystackPublicKey string
	// Public HTTPS base URL of this API (e.g. https://api.stark.ng).
	// Used for Paystack return URLs. Must never be localhost in production.
	APIBaseURL string

	// VTU provider credentials are server-side only.
	ProviderABaseURL string
	ProviderAKey     string
	ProviderBBaseURL string
	ProviderBKey     string

	CORSOrigins []string
	StorageDir  string

	// Region is the deployment's honest self-label, reported by
	// GET /api/v1/diagnostics/ping so clients never invent edge claims
	// (§24). Configure per deployment; defaults to "core".
	Region string
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func LoadConfig() Config {
	return Config{
		Env:               env("STARK_ENV", "development"),
		Port:              env("STARK_PORT", "8080"),
		DatabaseURL:       env("STARK_DB_URL", "postgres://stark:stark@localhost:5432/stark?sslmode=disable"),
		RedisURL:          env("STARK_REDIS_URL", "redis://localhost:6379/0"),
		JWTAccessSecret:   env("STARK_JWT_ACCESS_SECRET", "change-me-access"),
		JWTRefreshSecret:  env("STARK_JWT_REFRESH_SECRET", "change-me-refresh"),
		PaystackSecretKey: env("PAYSTACK_SECRET_KEY", ""),
		PaystackBaseURL:   env("PAYSTACK_BASE_URL", "https://api.paystack.co"),
		ProviderABaseURL:  env("VTU_PROVIDER_A_URL", ""),
		ProviderAKey:      env("VTU_PROVIDER_A_KEY", ""),
		ProviderBBaseURL:  env("VTU_PROVIDER_B_URL", ""),
		ProviderBKey:      env("VTU_PROVIDER_B_KEY", ""),
		CORSOrigins:       []string{env("STARK_CORS_ORIGINS", "*")},
		StorageDir:        env("STARK_STORAGE_DIR", "./storage"),
		Region:            env("STARK_REGION", "core"),
	}
}

/* ------------------------------------------------------------------ */
/* Structured logging. Secrets/PINs/tokens are never logged.           */
/* ------------------------------------------------------------------ */

func NewLogger(cfg Config) *slog.Logger {
	level := slog.LevelInfo
	if cfg.Env == "development" {
		level = slog.LevelDebug
	}
	h := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})
	return slog.New(h).With("service", "stark-api")
}

/* ------------------------------------------------------------------ */
/* PostgreSQL (pgxpool) and Redis clients.                             */
/* ------------------------------------------------------------------ */

func NewDB(ctx context.Context, cfg Config) (*pgxpool.Pool, error) {
	pcfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse db url: %w", err)
	}
	pcfg.MaxConns = 20
	pcfg.MinConns = 2
	pcfg.MaxConnLifetime = time.Hour
	pool, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		return nil, fmt.Errorf("new pool: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}
	return pool, nil
}

func NewCache(cfg Config) (*redis.Client, error) {
	opts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	opts.DialTimeout = 5 * time.Second
	rdb := redis.NewClient(opts)
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return rdb, nil
}

/* ------------------------------------------------------------------ */
/* HTTP: envelope responses, middleware stack, rate limiting.          */
/* ------------------------------------------------------------------ */

type Envelope struct {
	OK        bool        `json:"ok"`
	Data      any         `json:"data,omitempty"`
	Error     *ErrorBody  `json:"error,omitempty"`
	RequestID string      `json:"request_id,omitempty"`
}

type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func WriteJSON(w http.ResponseWriter, r *http.Request, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Envelope{
		OK:        status < 400,
		Data:      data,
		RequestID: chimw.GetReqID(r.Context()),
	})
}

func WriteErr(w http.ResponseWriter, r *http.Request, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Envelope{
		OK:        false,
		Error:     &ErrorBody{Code: code, Message: msg},
		RequestID: chimw.GetReqID(r.Context()),
	})
}

// RateLimit is a Redis-backed fixed-window limiter (per client IP).
func RateLimit(rdb *redis.Client, max int, window time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := fmt.Sprintf("rl:%s:%s", r.URL.Path, r.RemoteAddr)
			n, err := rdb.Incr(r.Context(), key).Result()
			if err == nil {
				if n == 1 {
					rdb.Expire(r.Context(), key, window)
				}
				if n > int64(max) {
					WriteErr(w, r, http.StatusTooManyRequests, "rate_limited",
						"Too many requests. Please slow down and try again.")
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func NewMux(cfg Config, log *slog.Logger, rdb *redis.Client) *chi.Mux {
	r := chi.NewRouter()

	r.Use(chimw.RequestID)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Idempotency-Key", "X-Device-ID"},
		AllowCredentials: false,
		MaxAge:           300,
	}))
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
			h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
			start := time.Now()
			next.ServeHTTP(w, r)
			log.Info("http",
				"method", r.Method, "path", r.URL.Path,
				"status", chimw.WrapResponseWriter(w, r.ProtoMajor).Status(),
				"ms", time.Since(start).Milliseconds(),
				"req_id", chimw.GetReqID(r.Context()))
		})
	})
	r.Use(RateLimit(rdb, 120, time.Minute))

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, r, http.StatusOK, map[string]string{"status": "ok"})
	})
	return r
}

/* ------------------------------------------------------------------ */
/* JWT: short-lived access tokens + rotating refresh tokens.           */
/* Revoked refresh JTIs are blacklisted in Redis until they expire.    */
/* ------------------------------------------------------------------ */

type TokenService struct {
	accessSecret  []byte
	refreshSecret []byte
	rdb           *redis.Client
}

func NewTokenService(cfg Config, rdb *redis.Client) *TokenService {
	return &TokenService{
		accessSecret:  []byte(cfg.JWTAccessSecret),
		refreshSecret: []byte(cfg.JWTRefreshSecret),
		rdb:           rdb,
	}
}

type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

func randomJTI() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *TokenService) IssuePair(userID string) (TokenPair, error) {
	now := time.Now()
	accessJTI := randomJTI()
	refreshJTI := randomJTI()

	access, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": userID, "jti": accessJTI, "typ": "access",
		"iat": now.Unix(), "exp": now.Add(15 * time.Minute).Unix(),
	}).SignedString(s.accessSecret)
	if err != nil {
		return TokenPair{}, err
	}
	refresh, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": userID, "jti": refreshJTI, "typ": "refresh",
		"iat": now.Unix(), "exp": now.Add(30 * 24 * time.Hour).Unix(),
	}).SignedString(s.refreshSecret)
	if err != nil {
		return TokenPair{}, err
	}
	return TokenPair{AccessToken: access, RefreshToken: refresh, ExpiresIn: 900, TokenType: "Bearer"}, nil
}

func (s *TokenService) VerifyAccess(tokenStr string) (string, error) {
	claims := jwt.MapClaims{}
	tok, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return s.accessSecret, nil
	})
	if err != nil || !tok.Valid || claims["typ"] != "access" {
		return "", errors.New("invalid access token")
	}
	sub, _ := claims["sub"].(string)
	return sub, nil
}

// Rotate implements refresh-token rotation: the presented refresh token is
// blacklisted (single use) and a fresh pair is issued. Replay of an old
// refresh token fails — a strong account-takeover signal.
func (s *TokenService) Rotate(ctx context.Context, refreshToken string) (TokenPair, error) {
	claims := jwt.MapClaims{}
	tok, err := jwt.ParseWithClaims(refreshToken, claims, func(t *jwt.Token) (any, error) {
		return s.refreshSecret, nil
	})
	if err != nil || !tok.Valid || claims["typ"] != "refresh" {
		return TokenPair{}, errors.New("invalid refresh token")
	}
	jti, _ := claims["jti"].(string)
	sub, _ := claims["sub"].(string)
	exp, _ := claims["exp"].(float64)

	set, err := s.rdb.SetNX(ctx, "rt:revoked:"+jti, "1", time.Until(time.Unix(int64(exp), 0))).Result()
	if err != nil {
		return TokenPair{}, err
	}
	if !set {
		return TokenPair{}, errors.New("refresh token reuse detected")
	}
	return s.IssuePair(sub)
}

func (s *TokenService) Revoke(ctx context.Context, refreshToken string) {
	claims := jwt.MapClaims{}
	if tok, err := jwt.ParseWithClaims(refreshToken, claims, func(t *jwt.Token) (any, error) {
		return s.refreshSecret, nil
	}); err == nil && tok.Valid {
		if jti, ok := claims["jti"].(string); ok {
			if exp, ok := claims["exp"].(float64); ok {
				s.rdb.SetNX(ctx, "rt:revoked:"+jti, "1", time.Until(time.Unix(int64(exp), 0)))
			}
		}
	}
}

/* ------------------------------------------------------------------ */
/* Idempotency + HMAC helpers shared by payments and purchases.        */
/* ------------------------------------------------------------------ */

// ClaimIdempotency returns true exactly once for a given key/window,
// preventing duplicate financial processing from retries or webhooks.
func ClaimIdempotency(ctx context.Context, rdb *redis.Client, key string, ttl time.Duration) (bool, error) {
	return rdb.SetNX(ctx, "idem:"+key, "1", ttl).Result()
}

func HMACSHA512Hex(secret string, payload []byte) string {
	mac := hmac.New(sha512New, []byte(secret))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

func SHA256Hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// ConstantTimeEqualHex compares two hex-encoded MACs without leaking
// timing information about where they differ (webhook signatures).
func ConstantTimeEqualHex(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
