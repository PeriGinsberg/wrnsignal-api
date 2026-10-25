-- 20261027_posting_links.sql
-- Cross-source linking of postings, built in REPORT-ONLY mode.
--
-- The fingerprint stays the identity of a row. This adds a second, looser
-- relation on top: two rows from different sources that are the same job
-- (same employer, same normalized title, a shared city) are LINKED, and the
-- direct-source row is primary. The rules live in one place, lib/ingest/link.ts,
-- and nothing in the database recomputes them.
--
-- WHAT THIS CREATES
--   postings.title_norm              generated, indexed: the linker's lookup key
--   postings.last_seen_elsewhere_at  when SerpApi last saw a direct-source row
--   posting_links                    secondary -> primary (EMPTY until the linker
--                                    is switched to write mode)
--   posting_link_runs                one row per linker run, with every proposed
--                                    link, ambiguous case, near miss and alias
--                                    suggestion: the report
--   postings_canonical               postings that are not a secondary
--
-- WHAT CHANGES: postings_touch_last_seen. A direct row's last_seen_at now moves
-- only when ITS OWN source re-finds it. A SerpApi re-find of a direct row sets
-- last_seen_elsewhere_at instead. Copies of a posting on other sites stay up
-- after the employer closes it (Phase 0 sample: Bain and Marsh closed on the
-- employer site, live on mirrors), so a Google sighting is not evidence that
-- the direct posting is still open.
--
-- Requires 20261025_ingest_serpapi_phase1.sql. Same commit changes
-- lib/ingest/runner.ts to classify added vs refound on created_at = updated_at,
-- because a SerpApi re-find no longer moves last_seen_at and the old test
-- (first_seen_at = last_seen_at) would count it as added. Apply this BEFORE
-- that code is promoted. Idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. postings columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.postings
  ADD COLUMN IF NOT EXISTS title_norm text GENERATED ALWAYS AS (public.ingest_norm_text(title)) STORED;

CREATE INDEX IF NOT EXISTS idx_postings_title_norm ON public.postings (title_norm);

ALTER TABLE public.postings
  ADD COLUMN IF NOT EXISTS last_seen_elsewhere_at timestamptz;

COMMENT ON COLUMN public.postings.title_norm IS
  'ingest_norm_text(title). Lookup key for cross-source linking (lib/ingest/link.ts).';
COMMENT ON COLUMN public.postings.last_seen_elsewhere_at IS
  'Last time a SerpApi (aggregator) result matched this direct-source row. Does not move last_seen_at: a mirror sighting is not evidence the posting is open.';

-- ---------------------------------------------------------------------------
-- 2. last_seen_at moves only on the row's own source
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.postings_touch_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  -- SerpApi re-finding a row another source owns: keep that row exactly as it
  -- was, and record the sighting separately.
  IF NEW.source = 'serpapi' AND OLD.source IS DISTINCT FROM 'serpapi' THEN
    NEW := OLD;
    NEW.last_seen_elsewhere_at = now();
    -- updated_at still moves: the runner reads created_at <> updated_at as
    -- "this row already existed", which is what this was.
    NEW.updated_at = now();
    RETURN NEW;
  END IF;
  -- Pinned in the database rather than by every caller remembering to omit it.
  NEW.first_seen_at = OLD.first_seen_at;
  NEW.last_seen_at  = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.postings_touch_last_seen() IS
  'BEFORE UPDATE on postings: pins first_seen_at and advances last_seen_at. A serpapi upsert onto another source''s row changes nothing but last_seen_elsewhere_at and updated_at.';

-- ---------------------------------------------------------------------------
-- 3. posting_links
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.posting_links (
  -- A row links to at most one primary.
  secondary_id uuid PRIMARY KEY REFERENCES public.postings(id) ON DELETE CASCADE,
  primary_id   uuid NOT NULL REFERENCES public.postings(id) ON DELETE CASCADE,

  -- 'city': the locations share a city. 'count_location': one side gave only a
  -- count ("10 Locations") and there was exactly one candidate on each side.
  tier text NOT NULL,
  employer_key text NOT NULL,
  matched_city text,
  rule_version text NOT NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT posting_links_not_self CHECK (primary_id <> secondary_id),
  CONSTRAINT posting_links_tier_valid CHECK (tier IN ('city', 'count_location'))
);

CREATE INDEX IF NOT EXISTS idx_posting_links_primary ON public.posting_links (primary_id);

COMMENT ON TABLE public.posting_links IS
  'Cross-source links: secondary_id is the same job as primary_id (the direct-source row). Written only when the linker runs in write mode (INGEST_LINK_MODE=write).';

-- ---------------------------------------------------------------------------
-- 4. posting_link_runs: the linker's run log and report
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.posting_link_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 'report' proposes and logs; 'write' also writes posting_links.
  mode text NOT NULL,
  rule_version text NOT NULL,
  -- What started it: 'nightly:grnhse', 'manual', ...
  triggered_by text NOT NULL,
  status text NOT NULL DEFAULT 'ok',

  postings_scanned integer NOT NULL DEFAULT 0,
  proposed_count   integer NOT NULL DEFAULT 0,
  ambiguous_count  integer NOT NULL DEFAULT 0,
  near_miss_count  integer NOT NULL DEFAULT 0,
  -- posting_links rows inserted/updated and deleted. Always 0 in report mode.
  written_count integer NOT NULL DEFAULT 0,
  removed_count integer NOT NULL DEFAULT 0,

  tier_counts       jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed          jsonb NOT NULL DEFAULT '[]'::jsonb,
  ambiguous         jsonb NOT NULL DEFAULT '[]'::jsonb,
  near_misses       jsonb NOT NULL DEFAULT '[]'::jsonb,
  alias_suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,

  error text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,

  CONSTRAINT posting_link_runs_mode_valid CHECK (mode IN ('report', 'write')),
  CONSTRAINT posting_link_runs_status_valid CHECK (status IN ('ok', 'error')),
  CONSTRAINT posting_link_runs_error_shape CHECK (
    (status = 'error' AND error IS NOT NULL) OR (status = 'ok' AND error IS NULL)
  ),
  -- Report mode never touches posting_links.
  CONSTRAINT posting_link_runs_report_writes_nothing CHECK (
    mode = 'write' OR (written_count = 0 AND removed_count = 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_posting_link_runs_started ON public.posting_link_runs (started_at DESC);

COMMENT ON TABLE public.posting_link_runs IS
  'One row per cross-source linker run. proposed/ambiguous/near_misses/alias_suggestions are the report; in report mode posting_links is not touched.';

-- ---------------------------------------------------------------------------
-- 5. postings_canonical
-- ---------------------------------------------------------------------------
-- security_invoker so the view obeys postings' RLS (enabled, no policy) for
-- whoever queries it. Without it a view runs as its owner and would expose
-- postings to the anon and authenticated roles through PostgREST.
CREATE OR REPLACE VIEW public.postings_canonical
WITH (security_invoker = true) AS
  SELECT p.*
  FROM public.postings p
  WHERE NOT EXISTS (SELECT 1 FROM public.posting_links l WHERE l.secondary_id = p.id);

REVOKE ALL ON public.postings_canonical FROM anon, authenticated;

COMMENT ON VIEW public.postings_canonical IS
  'Postings that are not the secondary of a cross-source link. Identical to postings while posting_links is empty (report mode).';

-- Global infrastructure: RLS on, no policy, service-role only.
ALTER TABLE public.posting_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posting_link_runs ENABLE ROW LEVEL SECURITY;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verify (every row true)
-- ---------------------------------------------------------------------------
-- SELECT 'title_norm' AS check, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='postings' AND column_name='title_norm') AS ok
-- UNION ALL SELECT 'last_seen_elsewhere_at', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='postings' AND column_name='last_seen_elsewhere_at')
-- UNION ALL SELECT 'posting_links empty', (SELECT count(*) FROM public.posting_links) = 0
-- UNION ALL SELECT 'posting_link_runs', to_regclass('public.posting_link_runs') IS NOT NULL
-- UNION ALL SELECT 'canonical = postings', (SELECT count(*) FROM public.postings_canonical) = (SELECT count(*) FROM public.postings)
-- UNION ALL SELECT 'trigger sets elsewhere', pg_get_functiondef('public.postings_touch_last_seen()'::regprocedure) LIKE '%last_seen_elsewhere_at%';
