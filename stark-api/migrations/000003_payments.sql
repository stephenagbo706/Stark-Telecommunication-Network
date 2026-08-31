-- +goose Up
-- ============================================================
-- STARK PAYMENTS — live-money Paystack support (append-only)
--
-- Extends the existing `payments` table; nothing here renames,
-- drops or rewrites existing financial data. Idempotency for
-- wallet credits is enforced by:
--   1. uq payments reference (existing, 000001)
--   2. conditional UPDATE ... WHERE status='pending' in Go
--   3. uq_ledger_idem on the funding posting (existing)
-- ============================================================

-- Paystack's numeric transaction id — recorded for reconciliation,
-- dispute evidence and audit. Distinct from `reference` (text).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_transaction_id BIGINT;

-- Payment channel reported by the gateway (card | bank | ussd | …).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS channel TEXT;

-- Why a payment failed / was rejected (amount_mismatch, currency_mismatch,
-- gateway_init_failed, abandoned, …). Never contains card data or secrets.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- Paystack reports "abandoned" when a customer starts but never
-- completes a charge. Widen the status domain safely.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending','successful','failed','refunded','abandoned'));

-- Reconciliation scans: pending payments older than the webhook window.
CREATE INDEX IF NOT EXISTS idx_payments_pending_age
  ON payments (created_at) WHERE status = 'pending';

-- Customer-facing payment history.
CREATE INDEX IF NOT EXISTS idx_payments_user_time
  ON payments (user_id, created_at DESC);

-- +goose Down
DROP INDEX IF EXISTS idx_payments_user_time;
DROP INDEX IF EXISTS idx_payments_pending_age;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending','successful','failed','refunded'));
ALTER TABLE payments DROP COLUMN IF EXISTS failure_reason;
ALTER TABLE payments DROP COLUMN IF EXISTS channel;
ALTER TABLE payments DROP COLUMN IF EXISTS provider_transaction_id;
