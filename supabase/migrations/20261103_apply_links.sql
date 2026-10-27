-- 20261103_apply_links.sql
-- Which apply link a Google Jobs posting gets, and a flag when the only links
-- are republished copies (lib/ingest/applyLinks.ts).
--
-- Why: a browser check of Alex's top 25 (2026-10-25) found 9 links landing on
-- AI-rewritten teasers on republishing sites (Jobleads, Jobrapido, Jobmesh,
-- Vaia), plus one expired copy and one behind a robot check.
--
--   apply_link_kind        employer / board / other / republisher / google, as
--                          chosen at ingest or by tests/ingest/backfill-apply-links.ts.
--                          NULL for direct sources (Greenhouse, SmartRecruiters,
--                          Workday): their link is the employer's own board.
--   apply_link_checked_at  when the link was last chosen from Google's list by
--                          the backfill. A write that changes it is a re-read of
--                          stored data, not a sighting: the trigger leaves
--                          last_seen_at alone, as it does for enrichment writes.
--   queue: apply_link_kind, and republished_only: true when Google gave no
--          employer or board link (the best it gave was a republisher, an
--          unknown site or its own share link). At equal score a republished-only
--          posting ranks below one with an employer or board link.
--
-- Requires 20261102_start_timing.sql. Same file for dev and prod. One transaction.

BEGIN;

DROP VIEW IF EXISTS public.client_match_queue;
DROP VIEW IF EXISTS public.postings_canonical;

ALTER TABLE public.postings
  ADD COLUMN IF NOT EXISTS apply_link_kind text,
  ADD COLUMN IF NOT EXISTS apply_link_checked_at timestamptz;

ALTER TABLE public.postings DROP CONSTRAINT IF EXISTS postings_apply_link_kind_known;
ALTER TABLE public.postings
  ADD CONSTRAINT postings_apply_link_kind_known CHECK (
    apply_link_kind IS NULL OR apply_link_kind IN ('employer', 'board', 'other', 'republisher', 'google')
  );
COMMENT ON COLUMN public.postings.apply_link_kind IS
  'What apply_url is: employer (own site or ATS), board, other, republisher (only when Google gave nothing better), google (share link). NULL for direct sources.';

-- The aggregator branch is unchanged from 20261028; the pin now also covers a
-- link re-choice (apply_link_checked_at changed).
CREATE OR REPLACE FUNCTION public.postings_touch_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source IN ('serpapi', 'searchapi')
     AND OLD.source IS DISTINCT FROM 'serpapi'
     AND OLD.source IS DISTINCT FROM 'searchapi' THEN
    NEW := OLD;
    NEW.last_seen_elsewhere_at = now();
    NEW.updated_at = now();
    RETURN NEW;
  END IF;

  NEW.first_seen_at = OLD.first_seen_at;

  -- A re-read of data already stored (enrichment, or re-choosing the apply
  -- link) is not a new sighting on the board.
  IF NEW.enriched_at IS NOT DISTINCT FROM OLD.enriched_at
     AND NEW.enrichment_failed_at IS NOT DISTINCT FROM OLD.enrichment_failed_at
     AND NEW.enrichment_description_md5 IS NOT DISTINCT FROM OLD.enrichment_description_md5
     AND NEW.apply_link_checked_at IS NOT DISTINCT FROM OLD.apply_link_checked_at THEN
    NEW.last_seen_at = now();
  ELSE
    NEW.last_seen_at = OLD.last_seen_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION public.postings_touch_last_seen() IS
  'BEFORE UPDATE on postings: an aggregator (serpapi/searchapi) upsert onto a direct source''s row changes nothing but last_seen_elsewhere_at and updated_at. Otherwise pins first_seen_at, and advances last_seen_at only on an ingest write: an enrichment write or an apply-link re-choice (enriched_at, enrichment_failed_at, enrichment_description_md5 or apply_link_checked_at changed) leaves it alone.';

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
  'Ranked review queue: unactioned postings that pass the client''s hard rules and were seen in the last 14 days, best score first, unjudged last. is_new = first queued after the client''s last review. start_label reads "start not stated" when the posting does not say. republished_only = Google gave no employer or board link; at equal score those rank lower.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- Verify (one row, every column true)
-- ---------------------------------------------------------------------------
-- SELECT
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'postings'
--      AND column_name IN ('apply_link_kind','apply_link_checked_at')) = 2 AS posting_columns,
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_match_queue' AND column_name = 'republished_only') AS queue_flag,
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'postings_canonical' AND column_name = 'apply_link_kind') AS canonical_rebuilt,
--   pg_get_functiondef('public.postings_touch_last_seen()'::regprocedure) LIKE '%apply_link_checked_at%'
--     AND pg_get_functiondef('public.postings_touch_last_seen()'::regprocedure) LIKE '%''searchapi''%'
--     AND pg_get_functiondef('public.postings_touch_last_seen()'::regprocedure) LIKE '%enrichment_description_md5%' AS trigger_all_branches;
