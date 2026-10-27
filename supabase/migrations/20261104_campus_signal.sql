-- 20261104_campus_signal.sql
-- A stated campus signal on postings, and in the queue.
--
-- Why: after start timing (20261102), 441 of Alex's 448 judged postings still
-- stated no start, so the start rule could not tell a campus role from an
-- experienced hire (2026-10-26).
--
--   campus_signal  true when the posting states it hires students or recent
--                  graduates (graduation window or class year, a start this
--                  year or next, new grad / university graduate, campus
--                  recruiting, an early-career program), with the quote in
--                  enrichment_evidence.campus; false when it does not; NULL
--                  until the posting is enriched with the field.
--
-- The judge (lib/match/judge.ts) scores a campus posting about 10 points above
-- an otherwise equal experienced-hire posting when the client cannot start
-- until a future date. No hard rule uses it.
--
-- Requires 20261103_apply_links.sql. Same file for dev and prod. One transaction.

BEGIN;

DROP VIEW IF EXISTS public.client_match_queue;
DROP VIEW IF EXISTS public.postings_canonical;

ALTER TABLE public.postings
  ADD COLUMN IF NOT EXISTS campus_signal boolean;
COMMENT ON COLUMN public.postings.campus_signal IS
  'The posting states it hires students or recent graduates (quote in enrichment_evidence.campus). NULL = not enriched with this field yet.';

ALTER TABLE public.postings
  DROP CONSTRAINT IF EXISTS postings_enrichment_requires_timestamp;
ALTER TABLE public.postings
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
      AND campus_signal IS NULL
      AND enrichment_evidence IS NULL
      AND enrichment_not_stated = '{}'::text[]
    )
  );

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
    p.campus_signal,
    p.apply_link_kind,
    coalesce(p.apply_link_kind IN ('republisher', 'other', 'google'), false) AS republished_only,
    row_number() OVER (
      PARTITION BY m.client_profile_id
      ORDER BY m.score DESC NULLS LAST,
               coalesce(p.apply_link_kind IN ('republisher', 'other', 'google'), false),
               m.first_queued_at DESC
    ) AS rank
  FROM public.posting_matches m
  JOIN public.client_match_criteria c ON c.client_profile_id = m.client_profile_id AND c.active
  JOIN public.postings_canonical p ON p.id = m.posting_id
  WHERE cardinality(m.rule_failures) = 0
    AND m.action IS NULL
    AND p.last_seen_at > now() - interval '14 days';
REVOKE ALL ON public.client_match_queue FROM anon, authenticated;
COMMENT ON VIEW public.client_match_queue IS
  'Ranked review queue: unactioned postings that pass the client''s hard rules and were seen in the last 14 days, best score first, unjudged last. is_new = first queued after the client''s last review. start_label reads "start not stated" when the posting does not say. republished_only = Google gave no employer or board link; at equal score those rank lower. campus_signal = the posting states it hires students or recent graduates.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- Verify (one row, every column true)
-- ---------------------------------------------------------------------------
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'postings' AND column_name = 'campus_signal') AS posting_column,
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_match_queue' AND column_name = 'campus_signal') AS queue_column,
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'postings_canonical' AND column_name = 'campus_signal') AS canonical_rebuilt,
--   pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.postings'::regclass AND conname = 'postings_enrichment_requires_timestamp')) LIKE '%campus_signal%' AS timestamp_check_names_it;
