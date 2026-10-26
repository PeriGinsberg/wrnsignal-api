-- 20261109_link_check_majors_market_link.sql
-- Three fixes from the coach review of Sami's top 14 (2026-10-26).
--
--   1. Closed postings. The nightly link check (lib/match/linkCheck.ts) reads
--      the apply page of each client's top 30. A page that says the job is
--      closed, expired, filled or no longer accepting sets closed_at, and a
--      closed posting is out of every queue. A bot wall or an error is
--      link_check_status 'unknown' and never closes anything.
--        closed_at             when a check found the page saying it is closed
--        link_checked_at       last check
--        link_check_status     open / closed / unknown
--        link_check_evidence   the words that decided it, or the reason it is unknown
--        link_check_url        the link that was checked
--   2. Required majors. Enrichment reads the degree fields a posting asks for,
--      with the quote in enrichment_evidence.majors, and the judge compares them
--      with the client's majors (client_match_criteria.majors).
--        postings.required_majors   as written; NULL = not stated
--        postings.majors_basis      required / preferred
--   3. The apply link per client. For a posting with several offices, matching
--      stores on the match row the link that names one of the client's market
--      cities, when that differs from the posting's own link. The queue shows
--      it in place of the posting's link.
--        posting_matches.apply_url, posting_matches.apply_link_kind
--
-- Link-check writes are re-reads, not sightings: the trigger leaves
-- last_seen_at alone for them, as it does for enrichment and link re-choices.
--
-- Same view as 20261107_queue_campus_score_floor.sql otherwise. Requires it.
-- Same file for dev and prod. One transaction.

BEGIN;

DROP VIEW IF EXISTS public.client_match_queue;
DROP VIEW IF EXISTS public.postings_canonical;

ALTER TABLE public.postings
  ADD COLUMN IF NOT EXISTS required_majors text[],
  ADD COLUMN IF NOT EXISTS majors_basis text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS link_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS link_check_status text,
  ADD COLUMN IF NOT EXISTS link_check_evidence text,
  ADD COLUMN IF NOT EXISTS link_check_url text;

ALTER TABLE public.postings DROP CONSTRAINT IF EXISTS postings_majors_basis_known;
ALTER TABLE public.postings
  ADD CONSTRAINT postings_majors_basis_known CHECK (
    (required_majors IS NULL AND majors_basis IS NULL)
    OR (required_majors IS NOT NULL AND majors_basis IS NOT NULL AND majors_basis IN ('required', 'preferred'))
  );
ALTER TABLE public.postings DROP CONSTRAINT IF EXISTS postings_link_check_status_known;
ALTER TABLE public.postings
  ADD CONSTRAINT postings_link_check_status_known CHECK (
    link_check_status IS NULL OR link_check_status IN ('open', 'closed', 'unknown')
  );
COMMENT ON COLUMN public.postings.required_majors IS
  'Degree fields the posting asks for, as written (catch-alls like "related field" kept). NULL = not stated. Quote in enrichment_evidence.majors.';
COMMENT ON COLUMN public.postings.closed_at IS
  'Set by the link check when the apply page says the job is closed, expired, filled or no longer accepting. A closed posting is out of every queue.';
COMMENT ON COLUMN public.postings.link_check_status IS
  'Last link check: open, closed, or unknown (bot wall, error, 404/410). Unknown never closes.';

ALTER TABLE public.client_match_criteria
  ADD COLUMN IF NOT EXISTS majors text;
COMMENT ON COLUMN public.client_match_criteria.majors IS
  'The client''s degree fields, as the coach states them. Judgment only. NULL = read the intake form''s major, else the resume.';

ALTER TABLE public.posting_matches
  ADD COLUMN IF NOT EXISTS apply_url text,
  ADD COLUMN IF NOT EXISTS apply_link_kind text;
ALTER TABLE public.posting_matches DROP CONSTRAINT IF EXISTS posting_matches_apply_link_kind_known;
ALTER TABLE public.posting_matches
  ADD CONSTRAINT posting_matches_apply_link_kind_known CHECK (
    (apply_url IS NULL AND apply_link_kind IS NULL)
    OR (apply_url IS NOT NULL AND apply_link_kind IN ('employer', 'board', 'other', 'republisher'))
  );
COMMENT ON COLUMN public.posting_matches.apply_url IS
  'This client''s apply link when it differs from the posting''s: the one naming the client''s market city. NULL = the posting''s own.';

-- The aggregator branch is unchanged from 20261103; the pin now also covers a
-- link check (link_checked_at changed).
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

  -- A re-read of data already stored (enrichment, re-choosing the apply link,
  -- or checking it) is not a new sighting on the board.
  IF NEW.enriched_at IS NOT DISTINCT FROM OLD.enriched_at
     AND NEW.enrichment_failed_at IS NOT DISTINCT FROM OLD.enrichment_failed_at
     AND NEW.enrichment_description_md5 IS NOT DISTINCT FROM OLD.enrichment_description_md5
     AND NEW.apply_link_checked_at IS NOT DISTINCT FROM OLD.apply_link_checked_at
     AND NEW.link_checked_at IS NOT DISTINCT FROM OLD.link_checked_at THEN
    NEW.last_seen_at = now();
  ELSE
    NEW.last_seen_at = OLD.last_seen_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION public.postings_touch_last_seen() IS
  'BEFORE UPDATE on postings: an aggregator (serpapi/searchapi) upsert onto a direct source''s row changes nothing but last_seen_elsewhere_at and updated_at. Otherwise pins first_seen_at, and advances last_seen_at only on an ingest write: an enrichment write, an apply-link re-choice or a link check (enriched_at, enrichment_failed_at, enrichment_description_md5, apply_link_checked_at or link_checked_at changed) leaves it alone.';

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
    q.*,
    row_number() OVER (
      PARTITION BY q.client_profile_id
      ORDER BY q.tier, q.score DESC NULLS LAST, q.republished_only, q.first_queued_at DESC
    ) AS rank
  FROM (
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
      coalesce(m.apply_url, p.apply_url) AS apply_url,
      (m.apply_url IS NOT NULL) AS market_link,
      p.years_min, p.years_max, p.years_basis,
      p.salary_low, p.salary_high, p.salary_period,
      p.application_deadline,
      p.requirements_summary,
      p.required_majors, p.majors_basis,
      p.posted_at,
      p.first_seen_at,
      p.last_seen_at,
      p.link_checked_at, p.link_check_status,
      p.start_type, p.start_date, p.start_season, p.start_year, p.start_text,
      p.employment_types,
      CASE p.start_type
        WHEN 'date' THEN 'starts ' || to_char(p.start_date, 'YYYY-MM-DD')
        WHEN 'season' THEN 'starts ' || p.start_season || ' ' || p.start_year
        WHEN 'immediate' THEN 'starts immediately'
        ELSE 'start not stated'
      END AS start_label,
      p.campus_signal,
      coalesce(m.apply_link_kind, p.apply_link_kind) AS apply_link_kind,
      coalesce(coalesce(m.apply_link_kind, p.apply_link_kind) IN ('republisher', 'other', 'google'), false) AS republished_only,
      c.available_from,
      t.timing_mode,
      CASE
        WHEN t.timing_mode = 'future_start' THEN CASE WHEN p.campus_signal AND m.score >= 40 THEN 1 ELSE 2 END
        WHEN t.stated_start > current_date + interval '3 months' THEN 2
        ELSE 1
      END::smallint AS tier,
      CASE
        WHEN t.timing_mode = 'future_start' THEN CASE WHEN p.campus_signal AND m.score >= 40 THEN 'campus' ELSE 'timing unknown' END
        WHEN t.stated_start > current_date + interval '3 months' THEN 'starts in 3+ months'
        ELSE 'now or not stated'
      END AS tier_label
    FROM public.posting_matches m
    JOIN public.client_match_criteria c ON c.client_profile_id = m.client_profile_id AND c.active
    JOIN public.postings_canonical p ON p.id = m.posting_id
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN c.available_from > current_date THEN 'future_start' ELSE 'available_now' END AS timing_mode,
        CASE p.start_type
          WHEN 'date' THEN p.start_date
          WHEN 'season' THEN make_date(p.start_year,
            CASE p.start_season WHEN 'spring' THEN 3 WHEN 'summer' THEN 6 WHEN 'fall' THEN 9 ELSE 1 END, 1)
        END AS stated_start
    ) t
    WHERE cardinality(m.rule_failures) = 0
      AND m.action IS NULL
      AND p.last_seen_at > now() - interval '14 days'
      AND p.closed_at IS NULL
  ) q;
REVOKE ALL ON public.client_match_queue FROM anon, authenticated;
COMMENT ON VIEW public.client_match_queue IS
  'Ranked review queue: unactioned postings that pass the client''s hard rules, were seen in the last 14 days and are not closed (link check). Ranked in timing tiers (20261106, 20261107): a client whose available_from is in the future gets campus postings scoring 40 or more first, then "timing unknown"; a client available now gets postings starting now, within 3 months or not stated first, then "starts in 3+ months". Within a tier: best score first, unjudged last, republished-only below others at equal score. apply_url is the client''s market link when matching chose one (market_link). is_new = first queued after the client''s last review.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- Verify (one row, every column true)
-- ---------------------------------------------------------------------------
-- SELECT
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'postings'
--      AND column_name IN ('required_majors','majors_basis','closed_at','link_checked_at','link_check_status','link_check_evidence','link_check_url')) = 7 AS posting_columns,
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_match_criteria' AND column_name = 'majors') AS criteria_majors,
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posting_matches'
--      AND column_name IN ('apply_url','apply_link_kind')) = 2 AS match_link_columns,
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'postings_canonical' AND column_name = 'closed_at') AS canonical_rebuilt,
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_match_queue' AND column_name = 'market_link') AS queue_rebuilt,
--   pg_get_functiondef('public.postings_touch_last_seen()'::regprocedure) LIKE '%link_checked_at%' AS trigger_pins_link_check,
--   pg_get_viewdef('public.client_match_queue'::regclass) LIKE '%closed_at IS NULL%' AS queue_drops_closed;
