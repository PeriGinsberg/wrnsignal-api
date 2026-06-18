-- App Store Connect downloads — manually hand-imported by Peri.
--
-- This is DOWNLOADS ONLY. App revenue / purchases come from iap_purchases
-- (RevenueCat webhook) and are NOT touched here. ASC has no public API in our
-- stack, so first-time-download counts are exported from App Store Connect and
-- imported into this table by hand.
--
-- One row per (date, source, territory). Re-importing an overlapping date
-- range UPDATES existing rows rather than duplicating, via:
--
--   INSERT INTO public.app_store_downloads (date, source, downloads, territory)
--   VALUES (...)
--   ON CONFLICT (date, source, territory)
--   DO UPDATE SET downloads = EXCLUDED.downloads, updated_at = now();
--
-- NOTE: territory is nullable, so the unique constraint is declared
-- NULLS NOT DISTINCT (Postgres 15+) — without it, default Postgres treats each
-- NULL territory as distinct and the ON CONFLICT upsert would NOT match
-- null-territory rows, silently duplicating on re-import.

CREATE TABLE IF NOT EXISTS public.app_store_downloads (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  date        date        NOT NULL,           -- calendar day the downloads occurred
  source      text        NOT NULL,           -- ASC source type, stored as-imported
                                              -- ('App Store Search','App Referrer',
                                              --  'Web Referrer','App Store Browse',
                                              --  'Unavailable', ...)
  downloads   integer     NOT NULL,           -- first-time downloads that day/source
  territory   text,                           -- optional country; null if not imported

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT app_store_downloads_date_source_territory_key
    UNIQUE NULLS NOT DISTINCT (date, source, territory)
);

COMMENT ON TABLE public.app_store_downloads IS
  'Manually imported App Store Connect first-time download counts (downloads only; revenue lives in iap_purchases). One row per (date, source, territory); re-import upserts on the unique key.';

-- Range/grouping support for the dashboard (filter by date, group by source).
CREATE INDEX IF NOT EXISTS idx_app_store_downloads_date
  ON public.app_store_downloads (date DESC);

-- Service-role-only access. RLS enabled with no policies, matching purchases /
-- iap_purchases / analytics_* — all reads and writes go through the service role.
ALTER TABLE public.app_store_downloads ENABLE ROW LEVEL SECURITY;
