-- 20261031_postings_enrichment_prod.sql
-- Enrichment, in one step, for a project that has NEVER had enrichment columns
-- (prod). Builds the same end state that dev reached through four files:
--
--   20260919_postings_enrichment.sql        three-state columns, failure columns
--   20260919_postings_function_trading.sql  "Trading" in the function list
--   20261029_postings_enrichment_v2.sql     v2 fields, run log, description hash,
--                                           restored last_seen_at guard
--   20261030_postings_salary_one_sided.sql  one-sided salary
--
-- Those four stay as dev's history; do NOT apply them on prod, apply this.
-- Requires 20261028_google_jobs_aggregators.sql (the aggregator branch of the
-- trigger below repeats it unchanged) and 20261027_posting_links.sql (the
-- postings_canonical view is recreated here).
--
-- See 20260919_postings_enrichment.sql and 20261029_postings_enrichment_v2.sql
-- for the reasoning behind each piece; comments here say what, not why.
--
-- Everything is IF NOT EXISTS / DROP IF EXISTS, in one transaction.
-- Adding the generated description_md5 rewrites postings: run it outside the
-- nightly window (crons 03:00 and 04:30 UTC).

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
  prompt_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  attempted integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  failed    integer NOT NULL DEFAULT 0,
  skipped_short integer NOT NULL DEFAULT 0,
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
-- 2. Columns. postings_canonical selects p.*, frozen at creation: dropped
--    here and recreated in step 6 so it carries the new columns.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.postings_canonical;

ALTER TABLE public.postings
  ADD COLUMN IF NOT EXISTS cleaned_title text,
  ADD COLUMN IF NOT EXISTS years_min integer,
  ADD COLUMN IF NOT EXISTS years_max integer,
  ADD COLUMN IF NOT EXISTS years_basis text,
  ADD COLUMN IF NOT EXISTS salary_low numeric(12, 2),
  ADD COLUMN IF NOT EXISTS salary_high numeric(12, 2),
  ADD COLUMN IF NOT EXISTS salary_period text,
  ADD COLUMN IF NOT EXISTS salary_currency text,
  ADD COLUMN IF NOT EXISTS graduation_text text,
  ADD COLUMN IF NOT EXISTS graduation_from text,
  ADD COLUMN IF NOT EXISTS graduation_to text,
  ADD COLUMN IF NOT EXISTS deadline_text text,
  ADD COLUMN IF NOT EXISTS application_deadline date,
  ADD COLUMN IF NOT EXISTS requirements_summary text,
  ADD COLUMN IF NOT EXISTS tools text[],
  ADD COLUMN IF NOT EXISTS level text,
  ADD COLUMN IF NOT EXISTS "function" text,
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS function_evidence text,
  ADD COLUMN IF NOT EXISTS industry_evidence text,
  ADD COLUMN IF NOT EXISTS enrichment_evidence jsonb,
  ADD COLUMN IF NOT EXISTS enrichment_not_stated text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz,
  ADD COLUMN IF NOT EXISTS enrichment_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS enrichment_error text,
  ADD COLUMN IF NOT EXISTS enrichment_run_id uuid REFERENCES public.enrichment_runs (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enrichment_description_md5 text,
  ADD COLUMN IF NOT EXISTS description_md5 text GENERATED ALWAYS AS (
    CASE
      WHEN coalesce(raw ->> 'description', '') = '' AND coalesce(raw ->> 'content', '') = '' THEN NULL
      ELSE md5(coalesce(raw ->> 'description', '') || '|' || coalesce(raw ->> 'content', ''))
    END
  ) STORED;

-- ---------------------------------------------------------------------------
-- 3. The trigger: the aggregator branch from 20261028 unchanged, plus the
--    guard that an enrichment write never moves last_seen_at.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. Constraints (dropped first so a re-run replaces rather than fails)
-- ---------------------------------------------------------------------------
ALTER TABLE public.postings
  DROP CONSTRAINT IF EXISTS postings_function_known,
  DROP CONSTRAINT IF EXISTS postings_industry_known,
  DROP CONSTRAINT IF EXISTS postings_function_has_evidence,
  DROP CONSTRAINT IF EXISTS postings_industry_has_evidence,
  DROP CONSTRAINT IF EXISTS postings_failure_has_reason,
  DROP CONSTRAINT IF EXISTS postings_tools_non_empty,
  DROP CONSTRAINT IF EXISTS postings_years_shape,
  DROP CONSTRAINT IF EXISTS postings_salary_shape,
  DROP CONSTRAINT IF EXISTS postings_graduation_shape,
  DROP CONSTRAINT IF EXISTS postings_deadline_shape,
  DROP CONSTRAINT IF EXISTS postings_not_stated_fields_known,
  DROP CONSTRAINT IF EXISTS postings_not_stated_excludes_value,
  DROP CONSTRAINT IF EXISTS postings_enrichment_requires_timestamp,
  DROP CONSTRAINT IF EXISTS postings_enriched_complete;

ALTER TABLE public.postings
  -- Same lists as FUNCTIONS and INDUSTRIES in lib/ingest/extractPosting.ts.
  ADD CONSTRAINT postings_function_known CHECK (
    "function" IS NULL OR "function" IN (
      'Marketing',
      'Finance and Accounting',
      'Trading',
      'Business Operations',
      'Project and Program Management',
      'Engineering',
      'Sales',
      'Account Management',
      'Data and Analytics',
      'Legal and Compliance',
      'Administrative and Clerical',
      'Research and Development',
      'Information Technology',
      'Customer Service',
      'Product Management',
      'Human Resources',
      'Design',
      'Consulting',
      'Supply Chain and Logistics',
      'Healthcare Services - Allied Health',
      'Healthcare Services - Nursing',
      'Healthcare Services - Advanced Practice',
      'Healthcare Services - Pharmacy',
      'Healthcare Services - Veterinary',
      'Skilled Trades',
      'Education'
    )
  ),
  ADD CONSTRAINT postings_industry_known CHECK (
    industry IS NULL OR industry IN (
      'Financial Services',
      'Banking',
      'Investment Banking & Capital Markets',
      'Investment & Asset Management',
      'Insurance',
      'Real Estate',
      'Construction',
      'Healthcare',
      'Pharmaceuticals & Biotech',
      'Software & Technology',
      'IT Services',
      'Management Consulting',
      'Professional Services',
      'Legal Services',
      'Marketing & Advertising',
      'Media & Publishing',
      'Entertainment',
      'Sports',
      'Social Media',
      'Retail & E-commerce',
      'Consumer Goods',
      'Beauty & Fashion',
      'Manufacturing',
      'Transportation & Logistics',
      'Energy & Utilities',
      'Higher Education',
      'Government & Public Sector'
    )
  ),
  ADD CONSTRAINT postings_function_has_evidence CHECK (
    "function" IS NULL OR btrim(coalesce(function_evidence, '')) <> ''
  ),
  ADD CONSTRAINT postings_industry_has_evidence CHECK (
    industry IS NULL OR btrim(coalesce(industry_evidence, '')) <> ''
  ),
  ADD CONSTRAINT postings_failure_has_reason CHECK (
    (enrichment_failed_at IS NULL AND enrichment_error IS NULL)
    OR (enrichment_failed_at IS NOT NULL AND btrim(coalesce(enrichment_error, '')) <> '')
  ),
  ADD CONSTRAINT postings_tools_non_empty CHECK (
    tools IS NULL
    OR (
      array_length(tools, 1) >= 1
      AND array_position(tools, NULL) IS NULL
      AND NOT ('' = ANY (tools))
    )
  ),
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
  -- Each end as stated: "from $90,000" is low only, "up to $120,000" high only.
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
  ADD CONSTRAINT postings_enriched_complete CHECK (
    enriched_at IS NULL OR (cleaned_title IS NOT NULL AND enrichment_evidence IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 5. The worklist
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS postings_enrichment_due_idx
  ON public.postings (first_seen_at)
  WHERE description_md5 IS NOT NULL
    AND enrichment_description_md5 IS DISTINCT FROM description_md5;

CREATE INDEX IF NOT EXISTS postings_enrichment_failed_idx
  ON public.postings (enrichment_failed_at)
  WHERE enrichment_failed_at IS NOT NULL;

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
-- 6. postings_canonical, recreated exactly as in 20261027_posting_links.sql
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
-- 7. Documentation
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.postings.enrichment_not_stated IS
  'Field groups the extractor read and found nothing for: years, salary, salary_currency, graduation, application_deadline, requirements_summary, tools, level, function, industry. A NULL value whose group is absent here means not yet enriched; never infer not-stated from a NULL alone.';
COMMENT ON COLUMN public.postings.enriched_at IS
  'When extraction last completed successfully for this row. Set even when every field came back not stated.';
COMMENT ON COLUMN public.postings.enrichment_failed_at IS
  'When the last extraction attempt gave up. Not retried while the description is unchanged; cleared by a later success.';
COMMENT ON COLUMN public.postings.enrichment_error IS
  'Why the last extraction attempt gave up. Required whenever enrichment_failed_at is set.';
COMMENT ON COLUMN public.postings.tools IS
  'Named software, platforms, languages and systems the posting asks for. Never empty: none named is ''tools'' in enrichment_not_stated.';
COMMENT ON COLUMN public.postings."function" IS
  'DISPLAY ONLY, never a filter (decided 2026-10-25). Closed vocabulary; requires function_evidence.';
COMMENT ON COLUMN public.postings.industry IS
  'DISPLAY ONLY, never a filter (decided 2026-10-25). The employer''s stated industry, closed vocabulary; requires industry_evidence.';
COMMENT ON COLUMN public.postings.years_min IS
  'Years of experience the posting states, lower end. 0 is a real answer ("no experience required"); not stated is ''years'' in enrichment_not_stated.';
COMMENT ON COLUMN public.postings.years_max IS
  'Upper end when the posting gives one ("0-2 years"). NULL beside years_min means open-ended ("3+").';
COMMENT ON COLUMN public.postings.salary_low IS
  'Lower end of the stated base pay, as stated (see salary_period). NULL beside salary_high is "up to"; never copied from salary_high.';
COMMENT ON COLUMN public.postings.salary_high IS
  'Upper end of the stated base pay. NULL beside salary_low is "from"; equal to salary_low for a single exact figure.';
COMMENT ON COLUMN public.postings.salary_period IS
  'year/month/week/day/hour as stated. Pay is never converted. NULL beside a figure: the posting gave no period.';
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
--                          'salary_currency','graduation_text','graduation_from','graduation_to','deadline_text',
--                          'application_deadline','requirements_summary','tools','level','function','industry',
--                          'function_evidence','industry_evidence','enrichment_evidence','enrichment_not_stated',
--                          'enriched_at','enrichment_failed_at','enrichment_error','enrichment_run_id',
--                          'enrichment_description_md5','description_md5')) = 28 AS columns,
--   to_regclass('public.enrichment_runs') IS NOT NULL AS runs_table,
--   to_regclass('public.postings_enrichment_due') IS NOT NULL AS due_view,
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'postings_canonical'
--      AND column_name = 'description_md5') = 1 AS canonical_view_rebuilt,
--   pg_get_functiondef('public.postings_touch_last_seen()'::regprocedure) LIKE '%enrichment_description_md5%'
--     AND pg_get_functiondef('public.postings_touch_last_seen()'::regprocedure) LIKE '%''searchapi''%' AS trigger_both_branches,
--   (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.postings'::regclass AND conname IN
--      ('postings_function_known','postings_industry_known','postings_function_has_evidence','postings_industry_has_evidence',
--       'postings_failure_has_reason','postings_tools_non_empty','postings_years_shape','postings_salary_shape',
--       'postings_graduation_shape','postings_deadline_shape','postings_not_stated_fields_known',
--       'postings_not_stated_excludes_value','postings_enrichment_requires_timestamp','postings_enriched_complete')) = 14 AS constraints,
--   pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.postings'::regclass AND conname = 'postings_function_known'))
--     LIKE '%''Trading''%' AS trading_allowed,
--   NOT EXISTS (SELECT 1 FROM public.postings WHERE enriched_at IS NOT NULL OR enrichment_failed_at IS NOT NULL) AS nothing_enriched_yet,
--   (SELECT count(*) FROM public.postings_enrichment_due) > 0 AS worklist_has_rows;
