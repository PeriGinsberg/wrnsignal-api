-- Attribution foundation: purchases table.
--
-- Records every successful Stripe checkout along with marketing attribution
-- dimensions (UTMs, landing page, referrer), ad-platform click IDs
-- (fbclid / ttclid / gclid), first-party pixel cookies (fbp / fbc / ttp),
-- and request context (client IP / user agent) needed to send server-side
-- Conversion API events with strong match quality.
--
-- Written by the Stripe webhook after the existing client_profiles upsert.
-- Read by the refund endpoint and by the conversion-fan-out logic when
-- replaying or retrying Conversion API calls.
--
-- One row per PaymentIntent. The UNIQUE(stripe_payment_intent_id)
-- constraint makes the webhook insert idempotent against Stripe retries.

CREATE TABLE IF NOT EXISTS public.purchases (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id         uuid        REFERENCES public.client_profiles(id) ON DELETE SET NULL,

  -- Identity
  email                     text        NOT NULL,

  -- Stripe references
  stripe_session_id         text        NOT NULL,
  stripe_payment_intent_id  text        NOT NULL UNIQUE,
  stripe_charge_id          text,

  -- Amount. Sourced from checkout session.amount_total so Promotion Codes
  -- (and any future dynamic pricing) are reflected accurately.
  amount_cents              integer     NOT NULL,
  currency                  text        NOT NULL DEFAULT 'usd',

  -- Marketing attribution (UTM + landing context)
  utm_source                text,
  utm_medium                text,
  utm_campaign              text,
  utm_content               text,
  utm_term                  text,
  landing_page              text,
  referrer                  text,

  -- Ad-platform click IDs (URL params set on the ad click-through)
  fbclid                    text,
  ttclid                    text,
  gclid                     text,

  -- Ad-platform first-party cookies (set by pixel libraries on the landing site).
  -- These will be empty until Meta/TikTok pixels are actually installed on Framer.
  fbp                       text,
  fbc                       text,
  ttp                       text,

  -- Match-quality request context, captured at /api/checkout/create-session
  -- time (the customer's browser hitting our API), NOT at webhook time
  -- (where the remote is Stripe's server).
  client_ip                 text,
  client_user_agent         text,

  -- Lifecycle
  created_at                timestamptz NOT NULL DEFAULT now(),
  refunded_at               timestamptz
);

COMMENT ON TABLE  public.purchases IS
  'One row per successful Stripe checkout. Persists attribution and match-quality signals for Conversion API fan-out and retry.';
COMMENT ON COLUMN public.purchases.amount_cents IS
  'Taken from stripe checkout session.amount_total so Promotion Code discounts are reflected.';
COMMENT ON COLUMN public.purchases.stripe_payment_intent_id IS
  'Also reused as the deduplication event_id across Meta / TikTok / Google Ads / GA4 Conversion API calls.';

CREATE INDEX IF NOT EXISTS idx_purchases_email
  ON public.purchases (email);
CREATE INDEX IF NOT EXISTS idx_purchases_client_profile
  ON public.purchases (client_profile_id)
  WHERE client_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchases_created_at
  ON public.purchases (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_utm
  ON public.purchases (utm_source, utm_campaign);

-- Service-role-only access. RLS is enabled with no policies, matching the
-- pattern of prior internal tables (see 20260422_analytics_foundation.sql).
-- All reads and writes go through the service role key from server routes.
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
