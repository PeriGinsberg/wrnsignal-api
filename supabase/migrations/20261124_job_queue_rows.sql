-- 20261124_job_queue_rows.sql
-- Job Queue: every row the page shows, in one database call.
--
-- Measured on prod 2026-11-02 (tests/jobqueue/time-prod.local.mts, read-only):
-- reading through the API in batches (matches per client, then postings,
-- flags and links by id, about 60 requests) took 12-18 s for all clients;
-- each request is a round trip. This function does the same reads as one
-- statement, with the filters as WHERE clauses on posting_matches:
--
--   p_clients        the clients to load (the coach's, or the one chosen)
--   p_min_score      undecided rows at or above it (the page's score filter)
--   p_floor          other clients' undecided rows from p_floor up to
--                    p_min_score, only on postings already kept (the page's
--                    "+N under 50" chips)
--   p_unscored       also undecided rows the judge has not scored
--   p_decided_since  also push / dismiss decisions since then
-- Evaluating rows (Add Job opened) always come back.
--
-- Each branch is a range of an index: posting_matches_jobqueue_idx (20261123)
-- for undecided rows, posting_matches_actioned_idx (20261120) for decisions,
-- posting_matches_posting_idx for the other clients' chips; postings, flags and
-- links by primary key. Linked secondaries are left out, as postings_canonical
-- does. Staleness, practice scoping of flags, tiers and ranking stay in
-- lib/match/jobQueue.ts, which computes them from these columns.
--
-- Returns one jsonb array (not a set): a set is capped at PostgREST's max rows.
-- Service role only. Requires 20261122 (posting_coach_flags.practice_coach_id).
-- Same file for dev and prod. Safe to run again.

CREATE OR REPLACE FUNCTION public.job_queue_rows(
  p_clients uuid[],
  p_min_score integer,
  p_floor integer DEFAULT 30,
  p_unscored boolean DEFAULT false,
  p_decided_since timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH kept AS (
    SELECT pm.id, pm.posting_id FROM posting_matches pm
    WHERE pm.client_profile_id = ANY (p_clients) AND pm.rule_failures = '{}'::text[]
      AND pm.action IS NULL AND pm.score >= p_min_score
    UNION ALL
    SELECT pm.id, pm.posting_id FROM posting_matches pm
    WHERE pm.client_profile_id = ANY (p_clients) AND pm.rule_failures = '{}'::text[]
      AND pm.action = 'evaluating'
    UNION ALL
    SELECT pm.id, pm.posting_id FROM posting_matches pm
    WHERE p_unscored AND pm.client_profile_id = ANY (p_clients) AND pm.rule_failures = '{}'::text[]
      AND pm.action IS NULL AND pm.score IS NULL
    UNION ALL
    SELECT pm.id, pm.posting_id FROM posting_matches pm
    WHERE p_decided_since IS NOT NULL AND pm.client_profile_id = ANY (p_clients)
      AND pm.action IN ('push', 'dismiss') AND pm.actioned_at >= p_decided_since
  ),
  extra AS (
    SELECT pm.id FROM posting_matches pm
    WHERE p_min_score > p_floor
      AND pm.posting_id IN (SELECT k.posting_id FROM kept k)
      AND pm.client_profile_id = ANY (p_clients) AND pm.rule_failures = '{}'::text[]
      AND pm.action IS NULL AND pm.score >= p_floor AND pm.score < p_min_score
  ),
  ids AS (
    SELECT k.id FROM kept k
    UNION
    SELECT e.id FROM extra e
  )
  SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  FROM (
    SELECT
      m.id, m.client_profile_id, m.posting_id, m.score, m.judge_reason, m.first_queued_at, m.action,
      m.apply_url, m.apply_link_kind, m.preferred_market, m.dismiss_reason, m.note, m.actioned_at,
      m.jobfit_score, m.jobfit_decision,
      p.source AS p_source, p.title AS p_title, p.cleaned_title AS p_cleaned_title, p.company AS p_company,
      p.location AS p_location, p.apply_url AS p_apply_url, p.apply_link_kind AS p_apply_link_kind,
      p.link_check_status AS p_link_check_status, p.years_min AS p_years_min, p.years_max AS p_years_max,
      p.years_basis AS p_years_basis, p.salary_low AS p_salary_low, p.salary_high AS p_salary_high,
      p.salary_period AS p_salary_period, p.application_deadline AS p_application_deadline,
      p.requirements_summary AS p_requirements_summary, p.first_seen_at AS p_first_seen_at,
      p.last_seen_at AS p_last_seen_at, p.closed_at AS p_closed_at, p.campus_signal AS p_campus_signal,
      p.start_type AS p_start_type, p.start_date AS p_start_date, p.start_season AS p_start_season,
      p.start_year AS p_start_year,
      (SELECT jsonb_agg(jsonb_build_object('practice_coach_id', f.practice_coach_id, 'flag', f.flag,
                                           'apply_url', f.apply_url, 'url_saved_at', f.url_saved_at))
         FROM posting_coach_flags f WHERE f.posting_id = p.id) AS flags
    FROM ids
    JOIN posting_matches m ON m.id = ids.id
    JOIN postings p ON p.id = m.posting_id
    WHERE NOT EXISTS (SELECT 1 FROM posting_links l WHERE l.secondary_id = p.id)
  ) x
$$;

REVOKE ALL ON FUNCTION public.job_queue_rows(uuid[], integer, integer, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_queue_rows(uuid[], integer, integer, boolean, timestamptz) TO service_role;
COMMENT ON FUNCTION public.job_queue_rows(uuid[], integer, integer, boolean, timestamptz) IS
  'Job Queue rows in one call (lib/match/jobQueue.ts loadJobQueue): undecided matches at p_min_score+, evaluating, optional unscored and decisions since p_decided_since, plus other clients'' p_floor+ rows on the same postings; with posting columns (p_*) and the posting''s coach flags. Service role only.';

NOTIFY pgrst, 'reload schema';

-- Verify (one row, true):
-- SELECT to_regprocedure('public.job_queue_rows(uuid[], integer, integer, boolean, timestamptz)') IS NOT NULL AS function_exists;
