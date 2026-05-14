-- Extend conversion_log to record upper-funnel events (Lead, ViewContent,
-- AddToCart, InitiateCheckout) in addition to the existing Purchase /
-- Refund rows from the Stripe webhook.
--
-- Upper-funnel events have no purchases row (the user hasn't paid yet),
-- so purchase_id must be nullable. event_type CHECK constraint expanded
-- to cover the new event names. A session_id column links funnel events
-- back to the user's browser session (jobfit_session_id from localStorage)
-- so we can stitch a funnel together for one user without an email.
--
-- Purchase / refund rows remain unchanged: their purchase_id is still
-- populated, their event_type still 'purchase' or 'refund'. New funnel
-- rows have purchase_id=NULL and event_type in the new set.

ALTER TABLE public.conversion_log
  ALTER COLUMN purchase_id DROP NOT NULL;

ALTER TABLE public.conversion_log
  DROP CONSTRAINT IF EXISTS conversion_log_event_type_chk;

ALTER TABLE public.conversion_log
  ADD CONSTRAINT conversion_log_event_type_chk CHECK (
    event_type IN (
      'purchase',
      'refund',
      'lead',
      'view_content',
      'add_to_cart',
      'initiate_checkout'
    )
  );

ALTER TABLE public.conversion_log
  ADD COLUMN IF NOT EXISTS session_id text;

COMMENT ON COLUMN public.conversion_log.purchase_id IS
  'FK to purchases.id for purchase/refund events. NULL for upper-funnel events (lead/view_content/add_to_cart/initiate_checkout) where no purchase row exists yet.';

COMMENT ON COLUMN public.conversion_log.session_id IS
  'Browser session id (jobfit_session_id from localStorage). Set on funnel events to correlate a user''s upper-funnel activity before purchase. NULL on purchase/refund rows (those correlate via purchase_id).';

COMMENT ON COLUMN public.conversion_log.event_id IS
  'Dedup key sent to the ad platform. Stripe payment_intent.id on purchase/refund events. crypto.randomUUID() generated client-side on funnel events; the same id is passed to both the browser pixel and the server-side CAPI call so the platform deduplicates the two fires.';

-- Index supporting "show me all funnel events for a session" queries.
CREATE INDEX IF NOT EXISTS idx_conversion_log_session
  ON public.conversion_log (session_id, created_at DESC)
  WHERE session_id IS NOT NULL;
