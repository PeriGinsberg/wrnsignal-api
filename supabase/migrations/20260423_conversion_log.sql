-- Attribution observability: conversion_log table.
--
-- Records every outbound Conversion API call fired from:
--   - the Stripe webhook on checkout.session.completed (event_type = 'purchase')
--   - the refund path on charge.refunded / /api/stripe/refund (event_type = 'refund')
--
-- One row per (purchase, platform, event_type) attempt. Captures success,
-- skipped (env vars missing — deploys safely before Erin's accounts exist),
-- and error states with enough detail for debugging without tailing logs.

CREATE TABLE IF NOT EXISTS public.conversion_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id      uuid        NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,

  platform         text        NOT NULL
                   CONSTRAINT conversion_log_platform_chk
                   CHECK (platform IN ('meta', 'tiktok', 'google_ads', 'ga4')),

  event_type       text        NOT NULL
                   CONSTRAINT conversion_log_event_type_chk
                   CHECK (event_type IN ('purchase', 'refund')),

  -- The dedup key sent to every ad platform. Always the Stripe
  -- payment_intent.id; purposely reused across purchase + refund events
  -- for the same PaymentIntent (platforms dedup on event_id + event_name,
  -- so Purchase and Refund events do not collide).
  event_id         text        NOT NULL,

  status           text        NOT NULL
                   CONSTRAINT conversion_log_status_chk
                   CHECK (status IN ('success', 'skipped', 'error')),

  -- 'success' rows: http_status + response_payload populated.
  -- 'skipped' rows: env vars missing; http_status and payload null.
  -- 'error'   rows: http_status + error_message populated (payload may be partial).
  http_status      integer,
  response_payload jsonb,
  error_message    text,

  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.conversion_log IS
  'Observability for outbound Conversion API calls. One row per (purchase, platform, event_type) attempt.';
COMMENT ON COLUMN public.conversion_log.event_id IS
  'Always the Stripe payment_intent.id. Reused across purchase and refund events for the same PaymentIntent.';

CREATE INDEX IF NOT EXISTS idx_conversion_log_purchase
  ON public.conversion_log (purchase_id);
CREATE INDEX IF NOT EXISTS idx_conversion_log_created_at
  ON public.conversion_log (created_at DESC);
-- Partial index optimized for "show me recent failures" dashboards.
CREATE INDEX IF NOT EXISTS idx_conversion_log_failures
  ON public.conversion_log (created_at DESC)
  WHERE status <> 'success';

ALTER TABLE public.conversion_log ENABLE ROW LEVEL SECURITY;
