// STARK Telecommunication — Go backend (FINAL STACK)
//
//   HTTP        → Chi (stdlib-friendly, middleware chain)
//   SQL         → SQLC (compile-time checked queries, pgx/v5 driver)
//   Migrations  → Goose  (see migrations/, run via `goose up`)
//   Cache/Jobs  → Redis  (OTP, rate limits, idempotency, locks, queues)
//   Auth        → JWT access + rotating refresh, Argon2id hashing
//   Payments    → Paystack (secret key server-side only)
//   Monitoring  → Sentry + structured slog logs
//
// SQLC is a code generator, not a runtime dependency:
//   go run github.com/sqlc-dev/sqlc/cmd/sqlc@latest generate
module stark-api

go 1.24

require (
	github.com/getsentry/sentry-go v0.29.1
	github.com/go-chi/chi/v5 v5.1.0
	github.com/go-chi/cors v1.2.1
	github.com/golang-jwt/jwt/v5 v5.2.1
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.7.2
	github.com/pressly/goose/v3 v3.24.0
	github.com/redis/go-redis/v9 v9.7.0
	golang.org/x/crypto v0.31.0
)
