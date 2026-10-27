-- 20261029_postings_enrichment_v2.sql
-- Enrichment v2: the fields lib/ingest/enrich.ts extracts (Haiku), a run log,
-- re-enrichment when a description changes, and the last_seen_at protection
-- that the 2026-10-25..28 trigger rewrites lost.
--
-- DEV ONLY for now. Requires 20260919_postings_enrichment.sql and
-- 20260919_postings_function_trading.sql (dev has both; prod has neither, so
-- prod will get one combined file later) and 20261028_google_jobs_aggregators.sql.
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGES
-- ---------------------------------------------------------------------------
--   years_required          -> years_min, years_max, years_basis
--   salary_min / salary_max -> salary_low, salary_high, salary_period, AS STATED
--                              (an hourly rate stays hourly; nothing annualised)
--   new                        graduation_text / graduation_from / graduation_to
--   new                        deadline_text / application_deadline
--   new                        cleaned_title, enrichment_evidence (quotes)
--   new                        enrichment_run_id -> enrichment_runs
--   new                        description_md5 (generated) and
--                              enrichment_description_md5 (what was last read)
--   function / industry        kept, DISPLAY ONLY (decided 2026-10-25)
--
-- The 20 dev rows enriched on 2026-09-19 by the Opus extractor are cleared and
-- will be re-enriched by the v2 writer: the old columns cannot hold v2 answers.
--
-- ---------------------------------------------------------------------------
-- THE THREE STATES, UNCHANGED IN PRINCIPLE
-- ---------------------------------------------------------------------------
-- enrichment_not_stated names the fields the extractor looked at and found
-- nothing for. v2 names a field GROUP rather than each column:
--
--   years                -> years_min, years_max, years_basis all NULL
--   salary               -> salary_low, salary_high, salary_period all NULL
--   salary_currency      -> salary_currency NULL
--   graduation           -> graduation_text, graduation_from, graduation_to NULL
--   application_deadline -> deadline_text, application_deadline NULL
--   requirements_summary, tools, level, function, industry -> that column NULL
--
-- A NULL inside a stated group is a value, not a gap: years_max NULL beside
-- years_min 3 is "3+"; salary_period NULL beside a range is "period not given";
-- application_deadline NULL beside deadline_text is "a deadline with no full
-- date"; graduation_from/to NULL beside graduation_text is a relative window
-- ("within 12 months of graduating").
--
-- ---------------------------------------------------------------------------
-- RE-ENRICHMENT ON A CHANGED DESCRIPTION
-- ---------------------------------------------------------------------------
-- description_md5 is generated from the stored description (SearchApi/SerpApi
-- raw.description, Greenhouse raw.content), NULL when there is none.
-- The writer copies it into enrichment_description_md5 on every attempt,
-- success, failure or "too short to read". A posting is due exactly when the
-- two differ:
--
--   never attempted                  -> NULL vs a value: due
--   attempted, description unchanged -> equal: not due (a failure is NOT retried
--                                       forever; retrying is a deliberate act)
--   description changed since        -> differ: due again, success or failure
--
-- postings_enrichment_due is that worklist. Nothing else decides it.

-- One transaction: a failure part-way leaves dev exactly as it was.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The run log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enrichment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  triggered_by text NOT NULL,
  model  text NOT NULL,
  effort text,
  -- sha256 of the system prompt, so a prompt change is visible in the data.
  prompt_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  attempted integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  failed    integer NOT NULL DEFAULT 0,
  -- Description under 200 characters: recorded as read, nothing extracted.
  skipped_short integer NOT NULL DEFAULT 0,
  -- function/industry returned with no quote, stored as not stated instead.
  demoted integer NOT NULL DEFAULT 0,
  api_calls integer NOT NULL DEFAULT 0,
  input_tokens       bigint NOT NULL DEFAULT 0,
  cache_read_tokens  bigint NOT NULL DEFAULT 0,
  cache_write_tokens bigint NOT NULL DEFAULT 0,
  output_tokens      bigint NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  error text,
  CONSTRAINT enrichment_runs_status_valid CHECK (status IN ('running', 'ok', 'error')),
  CONSTRAINT enrichment_runs_error_shape CHECK ((status = 'error') = (error IS NOT NULL))
);
ALTER TABLE public.enrichment_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.enrichment_runs FROM anon, authenticated;
COMMENT ON TABLE public.enrichment_runs IS
  'One row per enrichment run (lib/ingest/enrichPostings.ts): model, prompt hash, counts, tokens, cost. postings.enrichment_run_id points at the run that last wrote a row.';

-- ---------------------------------------------------------------------------
-- 2. Columns. The view selects p.*, which Postgres freezes at creation, so it
--    is dropped around the column changes and recreated unchanged after.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.postings_canonical;

ALTER TABLE public.postings
  DROP CONSTRAINT IF EXISTS postings_years_non_negative,
  DROP CONSTRAINT IF EXISTS postings_salary_non_negative,
  DROP CONSTRAINT IF EXISTS postings_salary_order,
  DROP CONSTRAINT IF EXISTS postings_not_stated_fields_known,
  DROP CONSTRAINT IF EXISTS postings_not_stated_excludes_value,
  DROP CONSTRAINT IF EXISTS postings_enrichment_requires_timestamp;

ALTER TABLE public.postings
  ADD COLUMN IF NOT EXISTS cleaned_title text,
  ADD COLUMN IF NOT EXISTS years_min integer,
  ADD COLUMN IF NOT EXISTS years_max integer,
  ADD COLUMN IF NOT EXISTS years_basis text,
  ADD COLUMN IF NOT EXISTS salary_low numeric(12, 2),
  ADD COLUMN IF NOT EXISTS salary_high numeric(12, 2),
  ADD COLUMN IF NOT EXISTS salary_period text,
  ADD COLUMN IF NOT EXISTS graduation_text text,
  ADD COLUMN IF NOT EXISTS graduation_from text,
  ADD COLUMN IF NOT EXISTS graduation_to text,
  ADD COLUMN IF NOT EXISTS deadline_text text,
  ADD COLUMN IF NOT EXISTS application_deadline date,
  ADD COLUMN IF NOT EXISTS enrichment_evidence jsonb,
  ADD COLUMN IF NOT EXISTS enrichment_run_id uuid REFERENCES public.enrichment_runs (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enrichment_description_md5 text,
  ADD COLUMN IF NOT EXISTS description_md5 text GENERATED ALWAYS AS (
    CASE
      WHEN coalesce(raw ->> 'description', '') = '' AND coalesce(raw ->> 'content', '') = '' THEN NULL
      ELSE md5(coalesce(raw ->> 'description', '') || '|' || coalesce(raw ->> 'content', ''))
    END
  ) STORED;

-- ---------------------------------------------------------------------------
-- 2b. The trigger, before the first UPDATE in this file.
-- ---------------------------------------------------------------------------
-- 20261025, 20261027 and 20261028 each rewrote this function without the
-- enriched_at branch from 20260919, so today an enrichment write would move
-- last_seen_at to now() as if the posting had just been re-found on its board.
-- Restored here, after the aggregator branch from 20261028 (unchanged).
CREATE OR REPLACE FUNCTION public.postings_touch_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  -- An aggregator re-finding a row a direct source owns: keep that row exactly
  -- as it was, and record the sighting separately.
  IF NEW.source IN ('serpapi', 'searchapi')
     AND OLD.source IS DISTINCT FROM 'serpapi'
     AND OLD.source IS DISTINCT FROM 'searchapi' THEN
    NEW := OLD;
    NEW.last_seen_elsewhere_at = now();
    -- updated_at still moves: the runner reads created_at <> updated_at as
    -- "this row already existed", which is what this was.
    NEW.updated_at = now();
    RETURN NEW;
  END IF;

  -- Pinned in the database rather than by every caller remembering to omit it.
  NEW.first_seen_at = OLD.first_seen_at;

  -- An enrichment write (success, failure, or a too-short skip) re-reads a
  -- description already stored. It is not a new sighting on the board.
  IF NEW.enriched_at IS NOT DISTINCT FROM OLD.enriched_at
     AND NEW.enrichment_failed_at IS NOT DISTINCT FROM OLD.enrichment_failed_at
     AND NEW.enrichment_description_md5 IS NOT DISTINCT FROM OLD.enrichment_description_md5 THEN
    NEW.last_seen_at = now();
  ELSE
    NEW.last_seen_at = OLD.last_seen_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Clear the 2026-09-19 Opus rows (20 on dev). Under the trigger above this does
-- not touch last_seen_at, because enriched_at changes.
UPDATE public.postings SET
  requirements_summary = NULL, tools = NULL, level = NULL,
  "function" = NULL, industry = NULL, function_evidence = NULL, industry_evidence = NULL,
  salary_currency = NULL,
  enrichment_not_stated = '{}'::text[],
  enriched_at = NULL, enrichment_failed_at = NULL, enrichment_error = NULL
WHERE enriched_at IS NOT NULL OR enrichment_failed_at IS NOT NULL;

ALTER TABLE public.postings
  DROP COLUMN IF EXISTS years_required,
  DROP COLUMN IF EXISTS salary_min,
  DROP COLUMN IF EXISTS salary_max;

-- ---------------------------------------------------------------------------
-- 3. Shape constraints
-- ---------------------------------------------------------------------------
ALTER TABLE public.postings
  ADD CONSTRAINT postings_years_shape CHECK (
    (years_min IS NULL AND years_max IS NULL AND years_basis IS NULL)
    OR (
      -- IS NOT NULL first: "NULL IN (...)" is NULL, and a CHECK passes on NULL.
      years_basis IS NOT NULL AND years_basis IN ('required', 'preferred')
      AND (years_min IS NOT NULL OR years_max IS NOT NULL)
      AND (years_min IS NULL OR years_min >= 0)
      AND (years_max IS NULL OR years_max >= coalesce(years_min, 0))
    )
  ),
  -- Each end as stated: "from $90,000" is low only, "up to $120,000" high only,
  -- a single exact figure both. (Changed by 20261030_postings_salary_one_sided.sql.)
  ADD CONSTRAINT postings_salary_shape CHECK (
    (salary_low IS NULL AND salary_high IS NULL AND salary_period IS NULL)
    OR (
      (salary_low IS NOT NULL OR salary_high IS NOT NULL)
      AND (salary_low IS NULL OR salary_low >= 0)
      AND (salary_high IS NULL OR salary_high >= 0)
      AND (salary_low IS NULL OR salary_high IS NULL OR salary_high >= salary_low)
      AND (salary_period IS NULL OR salary_period IN ('year', 'month', 'week', 'day', 'hour'))
    )
  ),
  ADD CONSTRAINT postings_graduation_shape CHECK (
    (graduation_text IS NOT NULL OR (graduation_from IS NULL AND graduation_to IS NULL))
    AND (graduation_from IS NULL OR graduation_from ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$')
    AND (graduation_to   IS NULL OR graduation_to   ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$')
  ),
  ADD CONSTRAINT postings_deadline_shape CHECK (
    application_deadline IS NULL OR deadline_text IS NOT NULL
  ),
  ADD CONSTRAINT postings_not_stated_fields_known CHECK (
    enrichment_not_stated <@ ARRAY[
      'years', 'salary', 'salary_currency', 'graduation', 'application_deadline',
      'requirements_summary', 'tools', 'level', 'function', 'industry'
    ]::text[]
  ),
  ADD CONSTRAINT postings_not_stated_excludes_value CHECK (
    (NOT ('years' = ANY (enrichment_not_stated)) OR (years_min IS NULL AND years_max IS NULL))
    AND (NOT ('salary' = ANY (enrichment_not_stated)) OR (salary_low IS NULL AND salary_high IS NULL))
    AND (NOT ('salary_currency' = ANY (enrichment_not_stated)) OR salary_currency IS NULL)
    AND (NOT ('graduation' = ANY (enrichment_not_stated)) OR graduation_text IS NULL)
    AND (NOT ('application_deadline' = ANY (enrichment_not_stated)) OR deadline_text IS NULL)
    AND (NOT ('requirements_summary' = ANY (enrichment_not_stated)) OR requirements_summary IS NULL)
    AND (NOT ('tools' = ANY (enrichment_not_stated)) OR tools IS NULL)
    AND (NOT ('level' = ANY (enrichment_not_stated)) OR level IS NULL)
    AND (NOT ('function' = ANY (enrichment_not_stated)) OR "function" IS NULL)
    AND (NOT ('industry' = ANY (enrichment_not_stated)) OR industry IS NULL)
  ),
  -- Nothing extracted without a timestamp, so "enriched_at IS NULL" means untouched.
  ADD CONSTRAINT postings_enrichment_requires_timestamp CHECK (
    enriched_at IS NOT NULL
    OR (
      cleaned_title IS NULL
      AND years_min IS NULL AND years_max IS NULL AND years_basis IS NULL
      AND salary_low IS NULL AND salary_high IS NULL AND salary_period IS NULL AND salary_currency IS NULL
      AND graduation_text IS NULL AND graduation_from IS NULL AND graduation_to IS NULL
      AND deadline_text IS NULL AND application_deadline IS NULL
      AND requirements_summary IS NULL AND tools IS NULL AND level IS NULL
      AND "function" IS NULL AND industry IS NULL
      AND function_evidence IS NULL AND industry_evidence IS NULL
      AND enrichment_evidence IS NULL
      AND enrichment_not_stated = '{}'::text[]
    )
  ),
  -- A successful row always carries a cleaned title and its evidence object.
  ADD CONSTRAINT postings_enriched_complete CHECK (
    enriched_at IS NULL OR (cleaned_title IS NOT NULL AND enrichment_evidence IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 4. The worklist
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.postings_unenriched_idx;
CREATE INDEX IF NOT EXISTS postings_enrichment_due_idx
  ON public.postings (first_seen_at)
  WHERE description_md5 IS NOT NULL
    AND enrichment_description_md5 IS DISTINCT FROM description_md5;

CREATE OR REPLACE VIEW public.postings_enrichment_due
WITH (security_invoker = true) AS
  SELECT p.id, p.source, p.title, p.company, p.location, p.raw, p.first_seen_at, p.description_md5,
         CASE WHEN p.enrichment_description_md5 IS NULL THEN 'new' ELSE 'changed' END AS reason
  FROM public.postings p
  WHERE p.description_md5 IS NOT NULL
    AND p.enrichment_description_md5 IS DISTINCT FROM p.description_md5;
REVOKE ALL ON public.postings_enrichment_due FROM anon, authenticated;
COMMENT ON VIEW public.postings_enrichment_due IS
  'Postings whose stored description has not been read by the enrichment writer: never attempted, or changed since the last attempt. A failed attempt on an unchanged description is not due again.';

-- ---------------------------------------------------------------------------
-- 5. postings_canonical, recreated exactly as in 20261027_posting_links.sql
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.postings_canonical
WITH (security_invoker = true) AS
  SELECT p.*
  FROM public.postings p
  WHERE NOT EXISTS (SELECT 1 FROM public.posting_links l WHERE l.secondary_id = p.id);
REVOKE ALL ON public.postings_canonical FROM anon, authenticated;
COMMENT ON VIEW public.postings_canonical IS
  'Postings that are not the secondary of a cross-source link. Identical to postings while posting_links is empty (report mode).';

-- ---------------------------------------------------------------------------
-- 6. Documentation
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.postings."function" IS
  'DISPLAY ONLY, never a filter (decided 2026-10-25). Closed vocabulary; requires function_evidence.';
COMMENT ON COLUMN public.postings.industry IS
  'DISPLAY ONLY, never a filter (decided 2026-10-25). The employer''s stated industry, closed vocabulary; requires industry_evidence.';
COMMENT ON COLUMN public.postings.years_min IS
  'Years of experience the posting states, lower end. 0 is a real answer ("no experience required"); not stated is ''years'' in enrichment_not_stated.';
COMMENT ON COLUMN public.postings.years_max IS
  'Upper end when the posting gives one ("0-2 years"). NULL beside years_min means open-ended ("3+").';
COMMENT ON COLUMN public.postings.salary_period IS
  'year/month/week/day/hour as stated. Pay is never converted. NULL beside a range: the posting gave no period.';
COMMENT ON COLUMN public.postings.deadline_text IS
  'The posting''s own words for its application deadline. application_deadline holds the date when the text gives a full one.';
COMMENT ON COLUMN public.postings.graduation_text IS
  'The posting''s own words for the graduation window. graduation_from/graduation_to (YYYY or YYYY-MM) only when the window is absolute.';
COMMENT ON COLUMN public.postings.description_md5 IS
  'Generated: md5 of the stored description (raw.description or raw.content), NULL when there is none.';
COMMENT ON COLUMN public.postings.enrichment_description_md5 IS
  'description_md5 as it was when the enrichment writer last read this row (success, failure or too short). Differs from description_md5 = due for enrichment.';
COMMENT ON FUNCTION public.postings_touch_last_seen() IS
  'BEFORE UPDATE on postings: an aggregator (serpapi/searchapi) upsert onto a direct source''s row changes nothing but last_seen_elsewhere_at and updated_at. Otherwise pins first_seen_at, and advances last_seen_at only on an ingest write: an enrichment write (enriched_at, enrichment_failed_at or enrichment_description_md5 changed) leaves it alone.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- Verify (one row, every column true)
-- ---------------------------------------------------------------------------
-- SELECT
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'postings'
--      AND column_name IN ('cleaned_title','years_min','years_max','years_basis','salary_low','salary_high','salary_period',
--                          'graduation_text','graduation_from','graduation_to','deadline_text','application_deadline',
--                          'enrichment_evidence','enrichment_run_id','enrichment_description_md5','description_md5')) = 16 AS new_columns,
--   NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'postings'
--      AND column_name IN ('years_required','salary_min','salary_max')) AS old_columns_gone,
--   to_regclass('public.enrichment_runs') IS NOT NULL AS runs_table,
--   to_regclass('public.postings_enrichment_due') IS NOT NULL AS due_view,
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'postings_canonical'
--      AND column_name = 'description_md5') = 1 AS canonical_view_rebuilt,
--   pg_get_functiondef('public.postings_touch_last_seen()'::regprocedure) LIKE '%enrichment_description_md5%'
--     AND pg_get_functiondef('public.postings_touch_last_seen()'::regprocedure) LIKE '%''searchapi''%' AS trigger_both_branches,
--   (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.postings'::regclass AND conname IN
--      ('postings_years_shape','postings_salary_shape','postings_graduation_shape','postings_deadline_shape',
--       'postings_not_stated_fields_known','postings_not_stated_excludes_value',
--       'postings_enrichment_requires_timestamp','postings_enriched_complete')) = 8 AS constraints,
--   NOT EXISTS (SELECT 1 FROM public.postings WHERE enriched_at IS NOT NULL OR enrichment_failed_at IS NOT NULL) AS opus_rows_cleared,
--   (SELECT count(*) FROM public.postings_enrichment_due) > 0 AS worklist_has_rows;
