-- 20261102_start_timing.sql
-- Start timing and employment type on postings; available_from on the client's
-- criteria; a 'start' hard rule; the queue shows "start not stated".
--
-- Why: the coach review of Alex's first queue (2026-10-25) found start timing
-- was the deciding gap. A June 2027 graduate was shown roles starting now and
-- internships starting this winter.
--
-- Requires 20261031_postings_enrichment_prod.sql (or dev's 20261029 + 20261030)
-- and 20261101_matching.sql. Same file for dev and prod. One transaction.
--
-- START TIMING, as the posting states it:
--   start_type 'date'       start_date (a month alone is stored as its 1st)
--   start_type 'season'     start_season + start_year ("Summer 2027")
--   start_type 'immediate'  "immediately", "ASAP", "start right away"
--   not stated              all NULL and 'start' in enrichment_not_stated
-- start_text is the posting's own words, always present when stated.
--
-- EMPLOYMENT TYPE: employment_types, the types the posting states (a "summer
-- internship, full-time hours" posting is both). Not stated: NULL and
-- 'employment_type' in enrichment_not_stated.
--
-- Rows enriched before this file have the new columns NULL and the new names
-- absent from enrichment_not_stated: "not yet looked", which is true. They are
-- re-enriched once by run-enrich --reenrich-before.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Postings: columns
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.client_match_queue;
DROP VIEW IF EXISTS public.postings_canonical;

ALTER TABLE public.postings
  ADD COLUMN IF NOT EXISTS start_type text,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS start_season text,
  ADD COLUMN IF NOT EXISTS start_year integer,
  ADD COLUMN IF NOT EXISTS start_text text,
  ADD COLUMN IF NOT EXISTS employment_types text[];

-- ---------------------------------------------------------------------------
-- 2. Postings: constraints (the three-state ones are replaced to name the new fields)
-- ---------------------------------------------------------------------------
ALTER TABLE public.postings
  DROP CONSTRAINT IF EXISTS postings_start_shape,
  DROP CONSTRAINT IF EXISTS postings_employment_types_known,
  DROP CONSTRAINT IF EXISTS postings_tools_non_empty,
  DROP CONSTRAINT IF EXISTS postings_not_stated_fields_known,
  DROP CONSTRAINT IF EXISTS postings_not_stated_excludes_value,
  DROP CONSTRAINT IF EXISTS postings_enrichment_requires_timestamp;

ALTER TABLE public.postings
  ADD CONSTRAINT postings_start_shape CHECK (
    (start_type IS NULL AND start_date IS NULL AND start_season IS NULL AND start_year IS NULL AND start_text IS NULL)
    OR (start_type IS NOT NULL AND start_text IS NOT NULL AND btrim(start_text) <> '' AND (
         (start_type = 'date' AND start_date IS NOT NULL AND start_season IS NULL AND start_year IS NULL)
      OR (start_type = 'season' AND start_date IS NULL AND start_season IS NOT NULL
          AND start_season IN ('spring', 'summer', 'fall', 'winter') AND start_year IS NOT NULL AND start_year BETWEEN 2000 AND 2100)
      OR (start_type = 'immediate' AND start_date IS NULL AND start_season IS NULL AND start_year IS NULL)
    ))
  ),
  -- cardinality, not array_length: array_length('{}', 1) is NULL, and a CHECK
  -- passes on NULL, so an empty array slipped through the 20260919 tools check.
  ADD CONSTRAINT postings_employment_types_known CHECK (
    employment_types IS NULL
    OR (cardinality(employment_types) >= 1
        AND employment_types <@ ARRAY['full_time','part_time','internship','contract','temporary','seasonal']::text[])
  ),
  ADD CONSTRAINT postings_tools_non_empty CHECK (
    tools IS NULL
    OR (cardinality(tools) >= 1 AND array_position(tools, NULL) IS NULL AND NOT ('' = ANY (tools)))
  ),
  ADD CONSTRAINT postings_not_stated_fields_known CHECK (
    enrichment_not_stated <@ ARRAY[
      'years', 'salary', 'salary_currency', 'graduation', 'application_deadline',
      'requirements_summary', 'tools', 'level', 'function', 'industry',
      'start', 'employment_type'
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
    AND (NOT ('start' = ANY (enrichment_not_stated)) OR start_type IS NULL)
    AND (NOT ('employment_type' = ANY (enrichment_not_stated)) OR employment_types IS NULL)
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
      AND start_type IS NULL AND start_text IS NULL AND employment_types IS NULL
      AND enrichment_evidence IS NULL
      AND enrichment_not_stated = '{}'::text[]
    )
  );

COMMENT ON COLUMN public.postings.start_type IS
  'date / season / immediate, as the posting states its start. NULL with ''start'' in enrichment_not_stated = the posting does not say.';
COMMENT ON COLUMN public.postings.start_text IS
  'The posting''s own words for when the job starts.';
COMMENT ON COLUMN public.postings.employment_types IS
  'Employment types the posting states: full_time, part_time, internship, contract, temporary, seasonal. Never empty.';

-- ---------------------------------------------------------------------------
-- 3. Criteria and matches
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_match_criteria
  ADD COLUMN IF NOT EXISTS available_from date;
COMMENT ON COLUMN public.client_match_criteria.available_from IS
  'Earliest date the client can start. Seeded from client_profiles.timeline when it names a month or season ("June 2027"); NULL = available now, no start rule.';

ALTER TABLE public.posting_matches
  DROP CONSTRAINT IF EXISTS posting_matches_rule_failures_known;
ALTER TABLE public.posting_matches
  ADD CONSTRAINT posting_matches_rule_failures_known CHECK (rule_failures <@ ARRAY[
    'location','years','graduation','excluded_title','excluded_employer','salary','job_type','start']::text[]);

-- ---------------------------------------------------------------------------
-- 4. Views, recreated (postings_canonical exactly as in 20261027; the queue
--    gains start timing, employment type and a start label)
-- ---------------------------------------------------------------------------
CREATE VIEW public.postings_canonical
WITH (security_invoker = true) AS
  SELECT p.*
  FROM public.postings p
  WHERE NOT EXISTS (SELECT 1 FROM public.posting_links l WHERE l.secondary_id = p.id);
REVOKE ALL ON public.postings_canonical FROM anon, authenticated;
COMMENT ON VIEW public.postings_canonical IS
  'Postings that are not the secondary of a cross-source link. Identical to postings while posting_links is empty (report mode).';

CREATE VIEW public.client_match_queue
WITH (security_invoker = true) AS
  SELECT
    m.client_profile_id,
    m.posting_id,
    m.score,
    m.judge_reason,
    m.judge_evidence,
    m.first_queued_at,
    (m.first_queued_at > coalesce(c.last_reviewed_at, '-infinity'::timestamptz)) AS is_new,
    p.source,
    coalesce(p.cleaned_title, p.title) AS title,
    p.company,
    p.location,
    p.apply_url,
    p.years_min, p.years_max, p.years_basis,
    p.salary_low, p.salary_high, p.salary_period,
    p.application_deadline,
    p.requirements_summary,
    p.posted_at,
    p.first_seen_at,
    p.last_seen_at,
    p.start_type, p.start_date, p.start_season, p.start_year, p.start_text,
    p.employment_types,
    CASE p.start_type
      WHEN 'date' THEN 'starts ' || to_char(p.start_date, 'YYYY-MM-DD')
      WHEN 'season' THEN 'starts ' || p.start_season || ' ' || p.start_year
      WHEN 'immediate' THEN 'starts immediately'
      ELSE 'start not stated'
    END AS start_label,
    row_number() OVER (PARTITION BY m.client_profile_id ORDER BY m.score DESC NULLS LAST, m.first_queued_at DESC) AS rank
  FROM public.posting_matches m
  JOIN public.client_match_criteria c ON c.client_profile_id = m.client_profile_id AND c.active
  JOIN public.postings_canonical p ON p.id = m.posting_id
  WHERE cardinality(m.rule_failures) = 0
    AND m.action IS NULL
    AND p.last_seen_at > now() - interval '14 days';
REVOKE ALL ON public.client_match_queue FROM anon, authenticated;
COMMENT ON VIEW public.client_match_queue IS
  'Ranked review queue: unactioned postings that pass the client''s hard rules and were seen in the last 14 days, best score first, unjudged last. is_new = first queued after the client''s last review. start_label reads "start not stated" when the posting does not say.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- Verify (one row, every column true)
-- ---------------------------------------------------------------------------
-- SELECT
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'postings'
--      AND column_name IN ('start_type','start_date','start_season','start_year','start_text','employment_types')) = 6 AS posting_columns,
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_match_criteria' AND column_name = 'available_from') AS available_from,
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_match_queue' AND column_name = 'start_label') AS queue_start_label,
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'postings_canonical' AND column_name = 'start_type') AS canonical_rebuilt,
--   pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.posting_matches'::regclass AND conname = 'posting_matches_rule_failures_known')) LIKE '%start%' AS start_rule_allowed,
--   pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.postings'::regclass AND conname = 'postings_not_stated_fields_known')) LIKE '%employment_type%' AS not_stated_names_new_fields;
