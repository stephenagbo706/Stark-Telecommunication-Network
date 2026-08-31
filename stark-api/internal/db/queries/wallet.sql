-- STARK money queries — compiled to type-safe Go by SQLC.
-- Invariants mirrored from the ledger engine:
--   * wallet rows are ALWAYS locked before mutation (FOR UPDATE)
--   * ledger_entries are INSERT-only (no UPDATE/DELETE queries exist)
--   * balances are BIGINT kobo; the app never computes them client-side

-- name: GetWalletForUpdate :one
SELECT user_id, available_kobo, reserved_kobo, currency
FROM wallets
WHERE user_id = $1
FOR UPDATE;

-- name: GetBalances :one
-- Includes the cashback balance derived from the ledger account.
SELECT w.available_kobo,
       w.reserved_kobo,
       COALESCE((SELECT SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount_kobo
                                 ELSE -le.amount_kobo END)
                 FROM ledger_entries le
                 WHERE le.user_id = $1 AND le.account_kind = 'CASHBACK'), 0)::bigint AS cashback_kobo
FROM wallets w
WHERE w.user_id = $1;

-- name: InsertLedgerEntry :exec
INSERT INTO ledger_entries
  (id, posting_id, user_id, account_kind, direction, amount_kobo, transaction_id, idempotency_key, description)
VALUES
  ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- name: ListLedgerEntries :many
SELECT posting_id, account_kind, direction, amount_kobo, description, created_at
FROM ledger_entries
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: InsertTransaction :one
INSERT INTO transactions
  (id, ref, user_id, service, network, account, amount_kobo, fee_kobo, total_kobo, status, idempotency_key, metadata)
VALUES
  ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10, $11)
RETURNING id, ref, status;

-- name: LockTransaction :one
SELECT id, ref, status, provider_ref, token
FROM transactions
WHERE id = $1
FOR UPDATE;

-- name: ListTransactions :many
SELECT id, ref, service, network, account, total_kobo, status, token,
       provider_ref, failure_reason, created_at, completed_at
FROM transactions
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: StuckProcessingTransactions :many
-- Reconciliation target: PROCESSING older than the provider window.
SELECT id, ref, provider, provider_ref, updated_at
FROM transactions
WHERE status = 'PROCESSING'
  AND updated_at < now() - INTERVAL '10 minutes'
ORDER BY updated_at ASC
LIMIT $1;

-- name: RecordWebhook :one
-- Duplicate webhooks hit the unique (gateway, reference) index and fail.
INSERT INTO payment_webhooks (id, gateway, reference, payload, signature_ok)
VALUES ($1, $2, $3, $4, $5)
RETURNING id;

-- name: UpsertProviderHealth :exec
UPDATE providers
SET healthy = $2, latency_ms = $3, failures_24h = failures_24h + $4
WHERE id = $1;
