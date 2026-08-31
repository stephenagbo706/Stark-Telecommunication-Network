# STARK Admin Platform

Internal operations console for STARK Telecommunication. Per the final stack
decision, the **admin platform is Next.js + TypeScript** — the customer app
stays Flutter; only operators use this panel.

## Stack

| Layer   | Technology                          |
|---------|-------------------------------------|
| App     | Next.js 15 (App Router) + TypeScript|
| UI      | Tailwind CSS + shadcn/ui            |
| Data    | Server Actions → Go REST API        |
| Charts  | Recharts                            |
| Auth    | JWT (admin role) issued by the Go API |
| Deploy  | Docker (same Compose stack) behind Nginx |

## Structure

```
stark-admin/
├── app/
│   ├── layout.tsx                 # shell: sidebar + topbar + Stark dark theme
│   ├── page.tsx                   # → /dashboard
│   ├── (auth)/login/page.tsx      # operator sign-in (2FA enforced)
│   └── (console)/
│       ├── dashboard/page.tsx     # KPIs, revenue, provider uptime
│       ├── users/page.tsx         # search, freeze/unfreeze, verify
│       ├── wallets/page.tsx       # balances, ledger drill-down
│       ├── transactions/page.tsx  # filters, state machine view, refunds
│       ├── payments/page.tsx      # Paystack payments + webhook log
│       ├── services/              # airtime · data · cable · electricity · pins · sms · gifts
│       ├── providers/page.tsx     # enable/disable, priority, health, latency, balance
│       ├── disputes/page.tsx      # OPEN → UNDER_REVIEW → WAITING_PROVIDER → RESOLVED
│       ├── fraud/page.tsx         # risk queue: LOW / MEDIUM / HIGH
│       ├── rewards/page.tsx       # point rules, campaigns, expirations
│       ├── cashback/page.tsx      # campaigns, eligibility, ledger trail
│       ├── referrals/page.tsx     # abuse detection, device clustering
│       ├── subscriptions/page.tsx # renewal worker monitoring
│       ├── promotions/page.tsx    # banners, discounts, schedules
│       ├── notifications/page.tsx # broadcasts + FCM delivery stats
│       ├── support/page.tsx       # ticket queue
│       ├── reports/page.tsx       # reconciliation + settlement exports
│       ├── security/page.tsx      # sessions, audit log, API keys
│       └── settings/page.tsx      # fees, limits, provider routing
├── components/ui/                 # shadcn/ui primitives (Stark themed)
├── lib/
│   ├── api.ts                     # typed Go API client (server-only)
│   └── format.ts                  # kobo → ₦ formatting
└── next.config.ts
```

## Connecting to the Go API

The admin panel **never** talks to PostgreSQL directly. It consumes the same
Go REST API with an admin-scoped JWT:

- `POST /api/v1/admin/auth/login` — operator credentials + 2FA challenge
- `GET  /api/v1/admin/dashboard/kpis` — users, volume, revenue, provider health
- `GET  /api/v1/admin/transactions?status=&service=&from=&to=&page=`
- `POST /api/v1/admin/transactions/{id}/refund` — ledger REVERSAL posting
- `PUT  /api/v1/admin/providers/{id}` — enable, priority, circuit-breaker reset
- `POST /api/v1/admin/promotions` — campaign with start/end + eligibility
- `GET  /api/v1/admin/reports/reconciliation?date=` — Stark vs Paystack vs provider

Every admin mutation is written to `audit_logs` (actor, before/after JSON).

## Stark theme tokens (Tailwind)

```ts
colors: {
  cyan: "#00CFFF", deep: "#00A8CC",
  bg: "#050B14", surface: "#0A1220", card: "#101B2B", raised: "#142235",
  ink: "#FFFFFF", sub: "#8FA3B8",
  ok: "#22C55E", warn: "#F59E0B", bad: "#EF4444",
}
```

## Run

```bash
cd stark-admin
pnpm install            # or npm install
pnpm dev                # http://localhost:3000 (Go API on :8080)
pnpm build && pnpm start
```

Production: the `docker-compose.yml` in `stark-api/` gains an `admin` service
building this folder, served behind the shared Nginx at `admin.stark.example`.
