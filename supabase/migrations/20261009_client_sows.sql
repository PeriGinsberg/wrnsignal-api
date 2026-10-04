-- A client's SOW, and each package's default payment terms. 2026-10-09.
--
-- IN PLAIN ENGLISH
--
-- 1. client_sows: one SOW per attached package (engagement). It holds the
--    coach's opening paragraph for this client, an optional price for this
--    client, and the payment terms (full up front, or a split into payments,
--    each an amount and a number of days after Let's Go). Its status is draft
--    until it is sent (Step 3) and accepted (Step 4); the columns those steps
--    fill (the link's hash, the frozen sent copy, the Let's Go name and time)
--    are here now so the flow needs one migration, not three.
-- 2. coach_packages.default_payment: the terms a new SOW for that package
--    starts with. Null means full up front. Run the Search and All the Way
--    Through start as two payments, half on day 0 and half on day 45.
--
-- Additive: a new table and a new nullable column, plus the two packages'
-- defaults (set only where none is set). Safe to run twice.
--
-- Reversibility:
--   DROP TABLE IF EXISTS client_sows;
--   ALTER TABLE coach_packages DROP COLUMN IF EXISTS default_payment;

ALTER TABLE coach_packages
  ADD COLUMN IF NOT EXISTS default_payment JSONB;

UPDATE coach_packages
   SET default_payment = '{"mode": "split", "parts": [{"percent": 50, "days": 0}, {"percent": 50, "days": 45}]}'::jsonb
 WHERE name IN ('Run the Search', 'All the Way Through')
   AND default_payment IS NULL;

CREATE TABLE IF NOT EXISTS client_sows (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_client_id      UUID NOT NULL REFERENCES coach_clients(id) ON DELETE CASCADE,
  engagement_id        UUID NOT NULL UNIQUE REFERENCES coach_client_engagements(id) ON DELETE CASCADE,
  opening              TEXT CHECK (opening IS NULL OR char_length(opening) <= 3000),
  -- Null: the package total. Otherwise the price for this client, in cents.
  price_override_cents INTEGER CHECK (price_override_cents IS NULL OR price_override_cents >= 0),
  -- {"mode":"full"} or {"mode":"split","payments":[{"amount_cents":..,"days":..},..]}
  payment              JSONB NOT NULL DEFAULT '{"mode": "full"}'::jsonb,
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted')),
  -- Step 3: the private link (only its SHA-256 is stored) and the copy that was sent.
  token_hash           TEXT UNIQUE,
  sent_at              TIMESTAMPTZ,
  sent_by              UUID REFERENCES client_profiles(id) ON DELETE SET NULL,
  sent_snapshot        JSONB,
  -- Step 4: Let's Go.
  accepted_at          TIMESTAMPTZ,
  accepted_name        TEXT CHECK (accepted_name IS NULL OR char_length(accepted_name) <= 200),
  updated_by           UUID REFERENCES client_profiles(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS client_sows_coach_client_idx ON client_sows (coach_client_id);

DROP TRIGGER IF EXISTS trg_client_sows_set_updated_at ON client_sows;
CREATE TRIGGER trg_client_sows_set_updated_at
  BEFORE UPDATE ON client_sows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE client_sows ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
