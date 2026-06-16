-- App (Apple IAP) purchases, recorded by the RevenueCat webhook.
--
-- The Stripe equivalent is public.purchases. This is the IAP-side mirror so
-- app revenue can be summed alongside web revenue (gross cents, excluding
-- refunded rows). Kept SEPARATE from purchases so that table's Stripe-shaped
-- NOT NULL / UNIQUE constraints stay intact.
--
-- One row per Apple transaction. UNIQUE(apple_transaction_id) makes the
-- webhook insert idempotent against RevenueCat retries, mirroring how
-- purchases uses UNIQUE(stripe_payment_intent_id).

CREATE TABLE IF NOT EXISTS public.iap_purchases (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id      uuid        REFERENCES public.client_profiles(id) ON DELETE SET NULL,

  -- Identity
  email                  text        NOT NULL,

  -- RevenueCat / Apple references
  apple_transaction_id   text        NOT NULL UNIQUE,
  revenuecat_app_user_id text,
  product_id             text,

  -- Amount. Gross USD price from the RevenueCat event (event.price),
  -- converted to integer cents. Nullable: RevenueCat sends price=NULL when
  -- the amount is unknown. Matches purchases.amount_cents (gross) for parity.
  amount_cents           integer,
  currency               text,

  -- Lifecycle
  purchased_at           timestamptz,
  refunded_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.iap_purchases IS
  'One row per Apple IAP transaction (RevenueCat webhook). IAP-side mirror of public.purchases for unified revenue. Gross cents in amount_cents; refunded_at excludes refunded revenue.';

CREATE INDEX IF NOT EXISTS idx_iap_purchases_email
  ON public.iap_purchases (email);
CREATE INDEX IF NOT EXISTS idx_iap_purchases_client_profile
  ON public.iap_purchases (client_profile_id)
  WHERE client_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_iap_purchases_created_at
  ON public.iap_purchases (created_at DESC);

-- Service-role-only access. RLS enabled with no policies, matching purchases
-- and the analytics_* tables. All reads/writes go through the service role.
ALTER TABLE public.iap_purchases ENABLE ROW LEVEL SECURITY;
