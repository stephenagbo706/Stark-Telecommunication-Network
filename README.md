# ⌁ STARK TELECOMMUNICATION NETWORK

A production-grade Nigerian **telecommunications + fintech** platform: VTU services
(airtime · data · cable TV · electricity), a **double-entry wallet ledger**, Paystack
funding, referrals & rewards, biometric + PIN security, and Stark AI — delivered as one
connected system, not a collection of screens.

```
                    STARK USER
                        │
            ┌───────────▼───────────┐
            │    FLUTTER (client)   │  Riverpod · GoRouter · Dio · Drift · local_auth · FCM
            └───────────┬───────────┘
                   HTTPS / JWT
            ┌───────────▼───────────┐
            │      GO API (authority)│  Chi · Argon2id · JWT rotation · Paystack · VTU engine
            └───────┬───────────┬───┘
        ┌───────────▼──┐   ┌────▼──────────┐
        │ PostgreSQL 16│   │   Redis 7     │
        │ financial    │   │ OTP · locks · │
        │ source of    │   │ rate limits · │
        │ truth        │   │ idempotency   │
        └──────────────┘   └───────────────┘
```

> **The absolute rule:** Flutter never touches PostgreSQL, Redis, Paystack secrets, or
> VTU credentials. Go is the business authority. PostgreSQL is financial truth.
> Redis is ephemeral. Every naira moves as **integer kobo** through balanced,
> append-only ledger postings.

---

## Repository map

| Path | What it is | Status |
|---|---|---|
| `stark-flutter/` | Native mobile app — Flutter 3.x, Dart, Material 3 | Source complete · Wave 1 pending local toolchain |
| `stark-api/` | Go backend — Chi + pgx + go-redis + SQLC + Goose | Source complete · first `go build` pending |
| `stark-admin/` | Admin platform blueprint (Next.js + shadcn/ui) | Blueprint |
| `src/` | **Web reference preview** — React 18 + TS + Vite + Tailwind + Zustand | ✅ Builds & runs (`npm run dev`) |
| `deploy/` | Production Nginx edge (TLS, tiered rate limits) | Ready |
| `.github/workflows/` | CI — Go race tests, Flutter analyze/test, Compose build | Active |

The `src/` preview is a **reference implementation** of the Stark product experience.
It is not the production financial authority — that lives in `stark-api` + PostgreSQL.

## The money engine

Every purchase follows one pipeline — reserve, execute, settle **or** reverse:

```
RESERVE    Wallet −₦1,000  →  Wallet Reserve +₦1,000
SUCCESS    Wallet Reserve −₦1,000  →  Settlement +₦1,000
FAILURE    Wallet Reserve −₦1,000  →  Wallet +₦1,000   (auto-reversal — no lost funds)
```

- `Σ debits = Σ credits` on every posting, enforced before insert (`stark-api/internal/finance/finance.go`)
- Transaction state machine: `PENDING → PROCESSING → SUCCESSFUL | FAILED | REVERSED | REFUNDED`
- Idempotency keys + unique indexes + Redis claims — retries never double-charge
- Uncertain provider results stay `PROCESSING` until the reconciliation worker settles or reverses exactly once
- Paystack webhooks: HMAC signature → server-to-server re-verify → dedupe → idempotent ledger credit

## Identity & security

- **One email → one account · one phone → one account**, enforced by PostgreSQL unique
  indexes on normalized values (`+234…` canonical phones, lowercased emails). Race-tested
  with 8-way concurrent registration.
- Argon2id for passwords **and** transaction PIN · JWT access (15 min) + rotating refresh
  with Redis JTI blacklist · per-device sessions with revocation · account freeze.
- Biometrics stay on-device (`local_auth`) — only a boolean result is consumed.
- Stark AI **prepares** actions; money moves only after explicit confirm + PIN/biometric.

## Quick start

### Web reference preview
```bash
npm install && npm run dev        # → http://localhost:5173
```

### Go backend
```bash
cd stark-api
cp .env.example .env              # fill in real secrets — never commit .env
docker compose up --build         # postgres · redis · migrate (Goose) · api · worker
# API → http://localhost:8080
```

### Flutter app
```bash
cd stark-flutter
flutter create --platforms=android --project-name stark_telecom --org app.stark .  # materialize wrapper binaries
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter analyze && flutter test && flutter build apk --debug
# APK → build/app/outputs/flutter-apk/app-debug.apk
```

## Environment

All configuration is environment-driven (see `stark-api/.env.example` — names only, no secrets):
`STARK_ENV · STARK_DB_URL · STARK_REDIS_URL · STARK_JWT_ACCESS_SECRET · STARK_JWT_REFRESH_SECRET ·
PAYSTACK_SECRET_KEY · VTU_PROVIDER_A_URL/KEY · VTU_PROVIDER_B_URL/KEY · STARK_CORS_ORIGINS · STARK_STORAGE_DIR`

## Development waves

| Wave | Scope | Gate |
|---|---|---|
| **0 — Integrity** ✅ | Goose naming, `citext`, Dart D1/D2, `.env.example`, identity hardening | repo corrected |
| 1 — Flutter build | platform scaffolding, codegen, analyze, smoke tests | `flutter analyze` = 0 errors |
| 2 — Go compile | `go mod tidy`, build, vet, pure tests | `go build ./...` PASS |
| 3 — Database | migrations, DB-gated race tests | 19 tests PASS with `-race` |
| 4–6 — Integration | Flutter↔Go auth, Paystack sandbox, first VTU adapter | real E2E purchase |
| 7–8 — Hardening | reconciliation, FCM sender, worker exclusivity, R2/S3 | security checklist |
| 9 — Platform | admin + RBAC, AI gateway, production deploy | full-stack PASS |

## Testing

- `stark-api/internal/finance/finance_test.go` — ledger balance ×4, state machine ×2,
  reference format, concurrent overdraw, reserve→reverse, duplicate webhook
- `stark-api/internal/auth/identity_test.go` — normalization, duplicate registration,
  8-way registration race, multi-device single user, session ownership
- Run with `STARK_TEST_DB_URL` + `STARK_TEST_REDIS` against the Compose services;
  GitHub Actions runs the full matrix with `-race` on every push.

## Non-negotiables

1. Wallet balances come from the ledger — never the client, never Redis-only
2. Ledger is append-only; corrections are new REVERSAL postings
3. Financial POSTs are idempotent; retries never re-execute blindly
4. Secrets (Paystack, VTU, JWT, DB) live only in server environment
5. Provider uncertainty is reconciled — never faked, never double-charged
6. UI renders state; it never decides financial truth

---

**STARK** — fast · premium · secure · Nigerian-first.
