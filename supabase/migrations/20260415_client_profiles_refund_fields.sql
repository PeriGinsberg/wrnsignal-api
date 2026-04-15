-- Adds payment-tracking and refund fields to client_profiles so the
-- 7-day money-back guarantee can be automated.

ALTER TABLE public.client_profiles
  ADD COLUMN IF NOT EXISTS purchase_date timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_charge_id text,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

-- Speed up charge.refunded webhook lookups by customer id.
CREATE INDEX IF NOT EXISTS idx_client_profiles_stripe_customer_id
  ON public.client_profiles (stripe_customer_id);
