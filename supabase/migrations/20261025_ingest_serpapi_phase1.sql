-- 20261025_ingest_serpapi_phase1.sql
-- Job sourcing engine, Phase 1: what SerpApi (Google Jobs) needs on top of the
-- 2026-09-18 ingest schema. postings, ingest_pairs and ingest_runs already
-- exist and are NOT recreated here; ingest_runs already logs found_count and
-- added_count separately.
--
-- Paste into the Supabase SQL Editor. Idempotent: safe to run twice.
--
-- ORDER MATTERS ON PROD. lib/ingest/nightly.ts (same commit) selects
-- ingest_pairs.sources and .campus. Apply this BEFORE that code is promoted, or
-- the Greenhouse and SmartRecruiters crons fail on the select. Applying it
-- first is harmless to the code already deployed: both new columns default to
-- what every existing row already means.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ingest_pairs: campus flag, and which sources a pair is for
-- ---------------------------------------------------------------------------

-- campus = this pair is for campus / early-career hiring. A source that can
-- express it does; SerpApi appends the current class year to the query
-- ("management consulting analyst 2027 Boston, MA"), which Phase 0 showed
-- turns a consulting query into campus programmes. Sources that cannot express
-- it ignore it.
ALTER TABLE public.ingest_pairs
  ADD COLUMN IF NOT EXISTS campus boolean NOT NULL DEFAULT false;

-- Which sources run this pair. NULL = every source, which is what all 36
-- existing pairs meant when they were written, so they keep their behaviour.
--
-- WHY THIS EXISTS. The Greenhouse and SmartRecruiters crons sweep every active
-- pair against every board. Without a scope, a SerpApi pair would join those
-- sweeps, and SerpApi would pay one search per page for each of the 25 active
-- location-less ATS pairs. A pair says which sources it is for.
ALTER TABLE public.ingest_pairs
  ADD COLUMN IF NOT EXISTS sources text[];

ALTER TABLE public.ingest_pairs
  DROP CONSTRAINT IF EXISTS ingest_pairs_sources_not_empty;
-- An empty array would be a pair that no source runs, which is what
-- active = false already says. One spelling only.
ALTER TABLE public.ingest_pairs
  ADD CONSTRAINT ingest_pairs_sources_not_empty
  CHECK (sources IS NULL OR cardinality(sources) > 0);

-- A campus pair and a plain pair with the same title and location are two
-- different queries, so uniqueness now includes campus.
DROP INDEX IF EXISTS public.idx_ingest_pairs_unique;
DROP INDEX IF EXISTS public.idx_ingest_pairs_unique_nulloc;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_pairs_unique
  ON public.ingest_pairs (lower(btrim(title)), lower(btrim(location)), campus)
  WHERE location IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_pairs_unique_nulloc
  ON public.ingest_pairs (lower(btrim(title)), campus)
  WHERE location IS NULL;

COMMENT ON COLUMN public.ingest_pairs.campus IS
  'Pair targets campus / early-career hiring. SerpApi appends the current class year to the query; sources that cannot express it ignore it.';
COMMENT ON COLUMN public.ingest_pairs.sources IS
  'Sources that run this pair (postings.source values, e.g. {serpapi}). NULL = every source.';

-- ---------------------------------------------------------------------------
-- 2. employer_aliases
-- ---------------------------------------------------------------------------
-- The fingerprint is a de-duplicator, not a resolver (see the postings
-- comment in 20260918_ingest_schema.sql). Phase 0 measured why that matters:
-- Google Jobs returned JPMorganChase, J.P. Morgan Chase & Co., JP Morgan Chase,
-- Chase and "JPMC Candidate Experience page" for one employer, and hiring.cafe
-- returned Capitalone, Blueowl and Allisontransmission.
--
-- One row per spelling seen. alias_norm uses the same normalization as the
-- fingerprint, so "J.P. Morgan Chase & Co." and "j p morgan chase co" are one
-- alias rather than two. Deliberately NOT read by the fingerprint: that column
-- is IMMUTABLE and cannot read a table, and folding resolution into identity
-- would merge postings on a judgement that can later turn out wrong.
CREATE TABLE IF NOT EXISTS public.employer_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The spelling as a source gave it.
  alias text NOT NULL,
  alias_norm text GENERATED ALWAYS AS (public.ingest_norm_text(alias)) STORED,

  -- The one name every alias of this employer resolves to.
  canonical text NOT NULL,

  -- Why this mapping is believed, e.g. "Phase 0 overlap review".
  note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT employer_aliases_alias_not_blank CHECK (btrim(alias) <> ''),
  CONSTRAINT employer_aliases_canonical_not_blank CHECK (btrim(canonical) <> ''),
  -- One spelling resolves to one employer. A second mapping for the same
  -- spelling is a conflict to decide, not a row to add.
  CONSTRAINT employer_aliases_alias_norm_unique UNIQUE (alias_norm)
);

CREATE INDEX IF NOT EXISTS idx_employer_aliases_canonical
  ON public.employer_aliases (canonical);

DROP TRIGGER IF EXISTS employer_aliases_set_updated_at ON public.employer_aliases;
CREATE TRIGGER employer_aliases_set_updated_at
  BEFORE UPDATE ON public.employer_aliases
  FOR EACH ROW EXECUTE FUNCTION public.ingest_set_updated_at();

-- Global infrastructure, same as postings: RLS on, no policy, service-role only.
ALTER TABLE public.employer_aliases ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.employer_aliases IS
  'Company-name spellings mapped to one canonical employer. Matched on alias_norm (ingest_norm_text). Not used by the postings fingerprint.';

-- ---------------------------------------------------------------------------
-- 3. postings: an aggregator re-find must not overwrite a direct source's row
-- ---------------------------------------------------------------------------
-- SerpApi is the first source that can find a posting another source already
-- owns: Greenhouse's point72 board and Google Jobs both carry Point72's roles.
-- The fingerprint collides, as it should, and ingest's upsert then rewrites
-- every column. That would replace Greenhouse's direct apply link, board slug
-- and raw payload with an aggregator's.
--
-- So a SerpApi re-find of a row owned by another source only advances
-- last_seen_at. The reverse is allowed: a direct source re-finding a SerpApi
-- row takes it over, which upgrades the row to first-party data.
CREATE OR REPLACE FUNCTION public.postings_touch_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source = 'serpapi' AND OLD.source IS DISTINCT FROM 'serpapi' THEN
    NEW := OLD;
    NEW.updated_at = now();
  END IF;
  -- Pinned in the database rather than by every caller remembering to omit it.
  NEW.first_seen_at = OLD.first_seen_at;
  NEW.last_seen_at  = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.postings_touch_last_seen() IS
  'BEFORE UPDATE on postings: advances last_seen_at to now() and pins first_seen_at. A serpapi upsert onto a row owned by another source keeps that row unchanged apart from last_seen_at.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verify (run after; every row should say true)
-- ---------------------------------------------------------------------------
-- SELECT 'ingest_pairs.campus'  AS check, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ingest_pairs' AND column_name='campus')  AS ok
-- UNION ALL SELECT 'ingest_pairs.sources', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ingest_pairs' AND column_name='sources')
-- UNION ALL SELECT 'employer_aliases',     to_regclass('public.employer_aliases') IS NOT NULL
-- UNION ALL SELECT 'trigger has serpapi rule', pg_get_functiondef('public.postings_touch_last_seen()'::regprocedure) LIKE '%serpapi%'
-- UNION ALL SELECT 'existing pairs unscoped', NOT EXISTS (SELECT 1 FROM public.ingest_pairs WHERE sources IS NOT NULL AND created_at < '2026-10-25');
