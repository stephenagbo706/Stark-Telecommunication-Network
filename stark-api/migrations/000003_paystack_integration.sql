-- +goose Up
-- ============================================================
-- STARK TELECOMMUNICATION — Paystack Integration Schema
-- Adds Paystack-specific fields to payments table for production
-- Managed by Goose: goose -dir migrations postgres "$DB_URL" up
-- ============================================================

-- Add Paystack-specific columns to existing payments table
ALTER TABLE payments 
  ADD COLUMN IF NOT EXISTS paystack_authorization_code TEXT,
  ADD COLUMN IF NOT EXISTS paystack_access_code TEXT,
  ADD COLUMN IF NOT EXISTS paystack_channel TEXT,
  ADD COLUMN IF NOT EXISTS paystack_currency TEXT DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS paystack_customer_email TEXT,
  ADD COLUMN IF NOT EXISTS paystack_customer_phone TEXT,
  ADD COLUMN IF NOT EXISTS paystack_ip_address INET,
  ADD COLUMN IF NOT EXISTS paystack_log_url TEXT,
  ADD COLUMN IF NOT EXISTS paystack_message TEXT,
  ADD COLUMN IF NOT EXISTS paystack_metadata JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS paystack_risk_score REAL,
  ADD COLUMN IF NOT EXISTS webhook_event_id TEXT,
  ADD COLUMN IF NOT EXISTS webhook_signature_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Create index on webhook_event_id for idempotency checks
CREATE INDEX IF NOT EXISTS idx_payments_webhook_event ON payments (webhook_event_id) WHERE webhook_event_id IS NOT NULL;

-- Create index on idempotency_key
CREATE INDEX IF NOT EXISTS idx_payments_idempotency ON payments (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Add constraint to ensure successful payments have verified webhooks in production
-- (This is a soft constraint enforced at application level primarily)

-- Update status enum to include more granular states if needed
-- Note: PostgreSQL requires altering type to add new enum values
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'pending_webhook' AFTER 'pending';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'processing' AFTER 'pending_webhook';

-- +goose Down
-- Remove Paystack-specific columns
ALTER TABLE payments 
  DROP COLUMN IF EXISTS paystack_authorization_code,
  DROP COLUMN IF EXISTS paystack_access_code,
  DROP COLUMN IF EXISTS paystack_channel,
  DROP COLUMN IF NOT EXISTS paystack_currency,
  DROP COLUMN IF EXISTS paystack_customer_email,
  DROP COLUMN IF EXISTS paystack_customer_phone,
  DROP COLUMN IF EXISTS paystack_ip_address,
  DROP COLUMN IF EXISTS paystack_log_url,
  DROP COLUMN IF EXISTS paystack_message,
  DROP COLUMN IF EXISTS paystack_metadata,
  DROP COLUMN IF EXISTS paystack_risk_score,
  DROP COLUMN IF EXISTS webhook_event_id,
  DROP COLUMN IF EXISTS webhook_signature_verified,
  DROP COLUMN IF EXISTS idempotency_key;

DROP INDEX IF EXISTS idx_payments_webhook_event;
DROP INDEX IF EXISTS idx_payments_idempotency;
