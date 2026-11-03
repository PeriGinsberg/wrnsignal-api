-- 20261126_job_queue_already_added.sql
-- Job Queue: "Already added". A coach marks a job a Fit for a client because it
-- is ALREADY in the client's tracker (added before the Job Queue found it), so
-- nothing is added again and no JobFit runs.
--
-- posting_matches.already_added   true on a push (Fit) made this way; false on
--                                 a Fit made through Add Job (recommend-job,
--                                 with the JobFit result) and on every other
--                                 action. The weekly measure counts both as
--                                 Fits: either way the matcher was right.
-- job_queue_rows() returns it, so the page can show "Fit · already added".
-- The function body is 20261125's with that one column added.
--
-- Same file for dev and prod. Safe to run again. Run before deploying the code
-- that reads the column.

BEGIN;

ALTER TABLE public.posting_matches
  ADD COLUMN IF NOT EXISTS already_added boolean NOT NULL DEFAULT false;
ALTER TABLE public.posting_matches DROP CONSTRAINT IF EXISTS posting_matches_already_added_is_fit;
ALTER TABLE public.posting_matches ADD CONSTRAINT posting_matches_already_added_is_fit
  CHECK (NOT already_added OR action = 'push');
COMMENT ON COLUMN public.posting_matches.already_added IS
  'Job Queue: Fit marked because the job was already in the client''s tracker (nothing added, no JobFit run). Only on action = push.';

CREATE OR REPLACE FUNCTION public.job_queue_rows(
  p_clients uuid[],
  p_min_score integer,
  p_floor integer DEFAULT 30,
  p_unscored boolean DEFAULT false,
  p_decided_since timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public
AS $fn$
DECLARE
  v_ids uuid[];
  v_more uuid[];
  v_posts uuid[];
  v_out jsonb;
BEGIN
  -- Undecided at the score filter or above (posting_matches_jobqueue_idx).
  EXECUTE $q$
    SELECT coalesce(array_agg(id), '{}') FROM posting_matches
    WHERE client_profile_id = ANY ($1) AND rule_failures = '{}'::text[] AND action IS NULL AND score >= $2
  $q$ INTO v_ids USING p_clients, p_min_score;

  -- Add Job opened, not finished: always shown.
  EXECUTE $q$
    SELECT coalesce(array_agg(id), '{}') FROM posting_matches
    WHERE client_profile_id = ANY ($1) AND rule_failures = '{}'::text[] AND action = 'evaluating'
  $q$ INTO v_more USING p_clients;
  v_ids := v_ids || v_more;

  IF p_unscored THEN
    EXECUTE $q$
      SELECT coalesce(array_agg(id), '{}') FROM posting_matches
      WHERE client_profile_id = ANY ($1) AND rule_failures = '{}'::text[] AND action IS NULL AND score IS NULL
    $q$ INTO v_more USING p_clients;
    v_ids := v_ids || v_more;
  END IF;

  IF p_decided_since IS NOT NULL THEN
    -- posting_matches_actioned_idx
    EXECUTE $q$
      SELECT coalesce(array_agg(id), '{}') FROM posting_matches
      WHERE client_profile_id = ANY ($1) AND action IN ('push', 'dismiss') AND actioned_at >= $2
    $q$ INTO v_more USING p_clients, p_decided_since;
    v_ids := v_ids || v_more;
  END IF;

  -- Other clients' undecided rows from p_floor up to the filter, on the
  -- postings already kept: the page's "+N under 50" chips.
  IF p_min_score > p_floor AND cardinality(v_ids) > 0 THEN
    EXECUTE $q$
      SELECT coalesce(array_agg(DISTINCT posting_id), '{}') FROM posting_matches WHERE id = ANY ($1)
    $q$ INTO v_posts USING v_ids;
    EXECUTE $q$
      SELECT coalesce(array_agg(id), '{}') FROM posting_matches
      WHERE posting_id = ANY ($1) AND client_profile_id = ANY ($2) AND rule_failures = '{}'::text[]
        AND action IS NULL AND score >= $3 AND score < $4
    $q$ INTO v_more USING v_posts, p_clients, p_floor, p_min_score;
    v_ids := v_ids || v_more;
  END IF;

  IF cardinality(v_ids) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- The rows, by primary key, with the posting's columns and its coach flags.
  EXECUTE $q$
    SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    FROM (
      SELECT
        m.id, m.client_profile_id, m.posting_id, m.score, m.judge_reason, m.first_queued_at, m.action,
        m.apply_url, m.apply_link_kind, m.preferred_market, m.dismiss_reason, m.note, m.actioned_at,
        m.jobfit_score, m.jobfit_decision, m.already_added,
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
      FROM posting_matches m
      JOIN postings p ON p.id = m.posting_id
      WHERE m.id = ANY ($1)
        AND NOT EXISTS (SELECT 1 FROM posting_links l WHERE l.secondary_id = p.id)
    ) x
  $q$ INTO v_out USING (SELECT array_agg(DISTINCT u) FROM unnest(v_ids) u);

  RETURN v_out;
END
$fn$;

REVOKE ALL ON FUNCTION public.job_queue_rows(uuid[], integer, integer, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_queue_rows(uuid[], integer, integer, boolean, timestamptz) TO service_role;
COMMENT ON FUNCTION public.job_queue_rows(uuid[], integer, integer, boolean, timestamptz) IS
  'Job Queue rows in one call (lib/match/jobQueue.ts loadJobQueue), PL/pgSQL so each step is planned with its real values (20261125; already_added since 20261126): undecided matches at p_min_score+, evaluating, optional unscored and decisions since p_decided_since, plus other clients'' p_floor+ rows on the same postings; with posting columns (p_*) and the posting''s coach flags. Service role only.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify (every row true):
-- SELECT 'column' AS check, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posting_matches' AND column_name = 'already_added') AS ok
-- UNION ALL SELECT 'function returns it', pg_get_functiondef('public.job_queue_rows(uuid[], integer, integer, boolean, timestamptz)'::regprocedure) LIKE '%already_added%';
