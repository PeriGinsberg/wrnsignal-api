-- Adds Apple In-App Purchase (IAP) tracking fields to client_profiles,
-- supporting the RevenueCat webhook (IAP Unit 2 of the mobile self-serve
-- build). Mirrors the Stripe payment-field pattern from
-- 20260415_client_profiles_refund_fields.sql.
--
-- refunded_at + active already exist (from the Stripe refund flow) and are
-- reused for IAP refunds — no change to those columns here.
--
-- Applied manually via Supabase SQL Editor: dev first, then prod after the
-- webhook code is verified working.

ALTER TABLE public.client_profiles
  ADD COLUMN IF NOT EXISTS apple_transaction_id text,
  ADD COLUMN IF NOT EXISTS revenuecat_app_user_id text,
  ADD COLUMN IF NOT EXISTS iap_purchased_at timestamptz;

-- Idempotency key for the RevenueCat webhook. Implemented as a UNIQUE INDEX
-- (rather than a named ADD CONSTRAINT ... UNIQUE) so it can use IF NOT EXISTS
-- and match the repo's idempotent migration style. A unique index enforces
-- uniqueness identically; Postgres permits multiple NULLs, so existing Stripe
-- rows (apple_transaction_id IS NULL) are unaffected while duplicate IAP
-- transactions are rejected.
CREATE UNIQUE INDEX IF NOT EXISTS client_profiles_apple_transaction_id_key
  ON public.client_profiles (apple_transaction_id);
