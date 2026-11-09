-- 20261127_queue_release.sql
-- Job Queue: a nightly release instead of every match at once (Peri, 2026-11-09).
--
-- A match enters a client's queue only when it is released. Each night, after
-- matching, release_queue() releases per client:
--   * at most p_limit matches (PIPELINE_QUEUE_LIMIT, 8),
--   * from matches scoring p_floor+ (PIPELINE_QUEUE_FLOOR, 60); below that a
--     match never enters the queue,
--   * a match scoring p_deadline_min+ (PIPELINE_QUEUE_DEADLINE_MIN, 50) whose
--     stated application deadline is within 7 days enters even under the
--     floor and goes ahead of the rest; it counts against the limit,
--   * the rest in client_match_queue's rank order.
-- Unscored matches (no description, score NULL) are not released: they show in
-- the unscored view as before, outside the floor, the limit and expiry, and
-- are not counted below the floor (Peri, 2026-11-09).
-- A match not released within p_expire_nights nights (PIPELINE_QUEUE_EXPIRE_NIGHTS,
-- 7; its arrival night counts as the first) expires: queue_expired_at is set
-- and it is never shown. Nights are UTC dates, as in pipeline_runs.night.
--
-- posting_matches.released_at      when it entered the queue (NULL: not released)
-- posting_matches.released_night   the night release_queue() released it; NULL
--                                  for the backfill, so the backfill does not
--                                  count against tonight's limit
-- posting_matches.queue_expired_at when it expired unreleased
--
-- client_match_candidates  every match client_match_queue used to show (live,
--                          not closed, not flagged), released or not; what
--                          release_queue() picks from. No rank.
-- client_match_queue       now released rows, unscored rows and Add Job in
--                          progress only,
--                          ranked among themselves. Same columns as before
--                          plus the three above, before rank.
-- job_queue_rows()         undecided scored rows only when released (unscored
--                          rows as before); the body is 20261126's with that
--                          filter added.
--
-- BACKFILL: undecided matches already in the queue at 60+ are released, so no
-- job a coach can see at 60+ disappears. Undecided matches under 60 are not:
-- they leave the queue now (the floor). Decided rows are marked released.
-- Unscored rows need no backfill: they show without release.
--
-- Same file for dev and prod. Safe to run again. Run BEFORE deploying the code
-- that calls release_queue() and filters on released_at.

BEGIN;

ALTER TABLE public.posting_matches
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_night date,
  ADD COLUMN IF NOT EXISTS queue_expired_at timestamptz;
COMMENT ON COLUMN public.posting_matches.released_at IS 'Job Queue: when the match entered the client''s queue (release_queue, 20261127). NULL: not released; not shown.';
COMMENT ON COLUMN public.posting_matches.released_night IS 'Job Queue: the UTC night release_queue() released it. NULL for rows released by the 20261127 backfill.';
COMMENT ON COLUMN public.posting_matches.queue_expired_at IS 'Job Queue: when the match expired unreleased (not released within PIPELINE_QUEUE_EXPIRE_NIGHTS). Never shown.';

-- 20261101's trigger, except that an update changing only the queue state
-- (released / expired) keeps updated_at: runMatching re-matches a row when its
-- posting was enriched after updated_at, and a release is not a match.
CREATE OR REPLACE FUNCTION public.posting_matches_touch()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.first_queued_at = CASE WHEN cardinality(NEW.rule_failures) = 0 THEN now() ELSE NULL END;
  ELSE
    NEW.created_at = OLD.created_at;
    -- Only when the queue state changed and nothing else did; any other
    -- update, a no-op upsert included, stamps updated_at as before.
    IF (NEW.released_at, NEW.released_night, NEW.queue_expired_at) IS DISTINCT FROM (OLD.released_at, OLD.released_night, OLD.queue_expired_at)
       AND (to_jsonb(NEW) - ARRAY['released_at', 'released_night', 'queue_expired_at', 'updated_at'])
           = (to_jsonb(OLD) - ARRAY['released_at', 'released_night', 'queue_expired_at', 'updated_at']) THEN
      NEW.updated_at = OLD.updated_at;
    ELSE
      NEW.updated_at = now();
    END IF;
    NEW.first_queued_at = coalesce(OLD.first_queued_at, CASE WHEN cardinality(NEW.rule_failures) = 0 THEN now() END);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill, once: only rows not yet touched by a release.
UPDATE public.posting_matches SET released_at = coalesce(first_queued_at, updated_at, now())
WHERE released_at IS NULL AND queue_expired_at IS NULL AND released_night IS NULL
  AND rule_failures = '{}'::text[]
  AND (action IS NOT NULL OR score >= 60)
  AND NOT EXISTS (SELECT 1 FROM public.pipeline_runs WHERE step = 'queue_release');

-- Unreleased rows still waiting: release_queue() reads these by arrival time.
CREATE INDEX IF NOT EXISTS posting_matches_unreleased_idx
  ON public.posting_matches (first_queued_at)
  WHERE released_at IS NULL AND queue_expired_at IS NULL AND action IS NULL AND rule_failures = '{}'::text[];

ALTER TABLE public.pipeline_runs DROP CONSTRAINT IF EXISTS pipeline_runs_step_valid;
ALTER TABLE public.pipeline_runs ADD CONSTRAINT pipeline_runs_step_valid
  CHECK (step IN ('ats_grnhse', 'ats_smartrecruiters', 'google_jobs', 'enrich', 'match', 'queue_release', 'link_check'));

DROP VIEW IF EXISTS public.client_match_queue;

-- 20261122's inner query, plus released_at, released_night, queue_expired_at.
CREATE OR REPLACE VIEW public.client_match_candidates
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
      coalesce(f.apply_url, m.apply_url, p.apply_url) AS apply_url,
      (m.apply_url IS NOT NULL AND f.apply_url IS NULL) AS market_link,
      p.years_min, p.years_max, p.years_basis,
      p.salary_low, p.salary_high, p.salary_period,
      p.application_deadline,
      p.requirements_summary,
      p.required_majors, p.majors_basis,
      p.posted_at,
      p.first_seen_at,
      p.last_seen_at,
      p.link_checked_at, p.link_check_status,
      (p.link_check_status IS NOT DISTINCT FROM 'likely_closed') AS likely_closed,
      m.preferred_market,
      p.start_type, p.start_date, p.start_season, p.start_year, p.start_text,
      p.employment_types,
      CASE p.start_type
        WHEN 'date' THEN 'starts ' || to_char(p.start_date, 'YYYY-MM-DD')
        WHEN 'season' THEN 'starts ' || p.start_season || ' ' || p.start_year
        WHEN 'immediate' THEN 'starts immediately'
        ELSE 'start not stated'
      END AS start_label,
      p.campus_signal,
      CASE WHEN f.apply_url IS NOT NULL THEN 'employer' ELSE coalesce(m.apply_link_kind, p.apply_link_kind) END AS apply_link_kind,
      CASE WHEN f.apply_url IS NOT NULL THEN false
           ELSE coalesce(coalesce(m.apply_link_kind, p.apply_link_kind) IN ('republisher', 'other', 'google'), false) END AS republished_only,
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
      END AS tier_label,
      m.id AS match_id,
      m.action,
      f.flag AS coach_flag,
      f.apply_url AS coach_apply_url,
      (f.flag IS NOT DISTINCT FROM 'bad_link' AND f.apply_url IS NULL) AS bad_link,
      p.title AS raw_title,
      m.released_at,
      m.released_night,
      m.queue_expired_at
    FROM public.posting_matches m
    JOIN public.client_match_criteria c ON c.client_profile_id = m.client_profile_id AND c.active
    JOIN public.postings_canonical p ON p.id = m.posting_id
    LEFT JOIN LATERAL (
      SELECT
        (array_agg(pf.flag ORDER BY CASE pf.flag WHEN 'closed' THEN 0 WHEN 'not_us' THEN 1 ELSE 2 END) FILTER (WHERE pf.flag IS NOT NULL))[1] AS flag,
        (array_agg(pf.apply_url ORDER BY pf.url_saved_at DESC) FILTER (WHERE pf.apply_url IS NOT NULL))[1] AS apply_url
      FROM public.posting_coach_flags pf
      WHERE pf.posting_id = m.posting_id
        AND pf.practice_coach_id IN (
          SELECT cc.coach_profile_id FROM public.coach_clients cc
          WHERE cc.client_profile_id = m.client_profile_id AND cc.status = 'active'
          UNION
          SELECT d.principal_coach_profile_id FROM public.coach_clients cc
          JOIN public.coach_delegates d ON d.delegate_coach_profile_id = cc.coach_profile_id AND d.status = 'active'
          WHERE cc.client_profile_id = m.client_profile_id AND cc.status = 'active')
    ) f ON true
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
      AND (m.action IS NULL OR m.action = 'evaluating')
      AND p.last_seen_at > now() - interval '14 days'
      AND p.closed_at IS NULL
      AND (f.flag IS NULL OR f.flag = 'bad_link');

REVOKE ALL ON public.client_match_candidates FROM anon, authenticated;
COMMENT ON VIEW public.client_match_candidates IS
  'Every live, unflagged, undecided (or evaluating) match, released or not: what release_queue() (20261127) picks from. client_match_queue is the released part, ranked.';

CREATE VIEW public.client_match_queue
WITH (security_invoker = true) AS
  SELECT
    q.*,
    row_number() OVER (
      PARTITION BY q.client_profile_id
      ORDER BY q.likely_closed, q.bad_link, q.tier, q.score DESC NULLS LAST, q.preferred_market DESC, q.republished_only, q.first_queued_at DESC
    ) AS rank
  FROM public.client_match_candidates q
  WHERE q.action = 'evaluating' OR q.released_at IS NOT NULL OR q.score IS NULL;

REVOKE ALL ON public.client_match_queue FROM anon, authenticated;
COMMENT ON VIEW public.client_match_queue IS
  'A client''s Job Queue: released matches (release_queue, 20261127) and Add Job in progress, ranked: likely closed and bad links last, then tier, score, preferred market, republished last, newest.';

CREATE OR REPLACE FUNCTION public.release_queue(
  p_floor integer,
  p_limit integer,
  p_expire_nights integer,
  p_deadline_min integer,
  p_since timestamptz
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE
SET search_path = public
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  -- The oldest arrival night still in its window tonight: tonight is its last chance.
  v_first date := v_today - (p_expire_nights - 1);
  v_rel jsonb;
  v_exp jsonb;
  v_below jsonb;
BEGIN
  -- 1. Release: per client, deadline-urgent first, then queue rank, up to the
  --    limit less what was already released tonight (a second run the same
  --    night stays under the limit).
  WITH cand AS (
    SELECT q.match_id, q.client_profile_id,
      -- coalesce: no deadline must be false, not NULL (NULLs sort first in DESC).
      coalesce(q.score >= p_deadline_min AND q.application_deadline BETWEEN v_today AND v_today + 7, false) AS urgent,
      q.likely_closed, q.bad_link, q.tier, q.score, q.preferred_market, q.republished_only, q.first_queued_at
    FROM client_match_candidates q
    WHERE q.action IS NULL AND q.released_at IS NULL AND q.queue_expired_at IS NULL
      AND q.first_queued_at >= (v_first::timestamp AT TIME ZONE 'UTC')
      AND (q.score >= p_floor OR (q.score >= p_deadline_min AND q.application_deadline BETWEEN v_today AND v_today + 7))
  ), ranked AS (
    SELECT c.*, row_number() OVER (
      PARTITION BY c.client_profile_id
      ORDER BY c.urgent DESC, c.likely_closed, c.bad_link, c.tier, c.score DESC, c.preferred_market DESC, c.republished_only, c.first_queued_at DESC
    ) AS rn
    FROM cand c
  ), already AS (
    SELECT client_profile_id, count(*) AS n FROM posting_matches WHERE released_night = v_today GROUP BY client_profile_id
  ), rel AS (
    UPDATE posting_matches m SET released_at = now(), released_night = v_today
    FROM ranked r LEFT JOIN already a ON a.client_profile_id = r.client_profile_id
    WHERE m.id = r.match_id AND r.rn <= p_limit - coalesce(a.n, 0)
    RETURNING m.client_profile_id, r.urgent
  )
  SELECT coalesce(jsonb_object_agg(client_profile_id, jsonb_build_object('released', n, 'deadline', d)), '{}'::jsonb)
  INTO v_rel
  FROM (SELECT client_profile_id, count(*) AS n, count(*) FILTER (WHERE urgent) AS d FROM rel GROUP BY 1) x;

  -- 2. Expire: entered (floor, or deadline-eligible during its window), still
  --    unreleased after its last night. A separate statement, so it sees step 1
  --    (data-modifying CTEs in one statement share a snapshot).
  WITH exp AS (
    UPDATE posting_matches m SET queue_expired_at = now()
    FROM client_match_candidates q
    WHERE m.id = q.match_id AND q.action IS NULL AND q.released_at IS NULL AND q.queue_expired_at IS NULL
      AND q.first_queued_at < ((v_first + 1)::timestamp AT TIME ZONE 'UTC')
      AND q.first_queued_at >= ((v_today - 30)::timestamp AT TIME ZONE 'UTC')
      AND (q.score >= p_floor OR (q.score >= p_deadline_min AND q.application_deadline
            BETWEEN (q.first_queued_at AT TIME ZONE 'UTC')::date AND (q.first_queued_at AT TIME ZONE 'UTC')::date + (p_expire_nights - 1) + 7))
    RETURNING m.client_profile_id
  )
  SELECT coalesce(jsonb_object_agg(client_profile_id, n), '{}'::jsonb) INTO v_exp
  FROM (SELECT client_profile_id, count(*) AS n FROM exp GROUP BY 1) x;

  -- 3. Below the floor: matches that arrived since the last release and did not enter.
  SELECT coalesce(jsonb_object_agg(client_profile_id, n), '{}'::jsonb) INTO v_below
  FROM (
    SELECT m.client_profile_id, count(*) AS n FROM posting_matches m
    WHERE m.released_at IS NULL AND m.queue_expired_at IS NULL AND m.action IS NULL AND m.rule_failures = '{}'::text[]
      AND m.first_queued_at > p_since AND m.score < p_floor
    GROUP BY 1
  ) x;

  RETURN jsonb_build_object('released', v_rel, 'expired', v_exp, 'below_floor', v_below);
END
$fn$;

REVOKE ALL ON FUNCTION public.release_queue(integer, integer, integer, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_queue(integer, integer, integer, integer, timestamptz) TO service_role;
COMMENT ON FUNCTION public.release_queue(integer, integer, integer, integer, timestamptz) IS
  'Nightly Job Queue release (20261127; lib/pipeline/queueRelease.ts): per client at most p_limit of the p_floor+ matches (deadline within 7 days at p_deadline_min+ first), then expires matches unreleased after p_expire_nights. Returns per-client released/deadline, expired, below_floor (arrived since p_since). Service role only.';

-- job_queue_rows(): 20261126's body, undecided rows only when released.
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
    WHERE client_profile_id = ANY ($1) AND rule_failures = '{}'::text[] AND action IS NULL AND released_at IS NOT NULL AND score >= $2
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
        AND action IS NULL AND released_at IS NOT NULL AND score >= $3 AND score < $4
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
  'Job Queue rows in one call (lib/match/jobQueue.ts loadJobQueue), PL/pgSQL so each step is planned with its real values (20261125; already_added since 20261126; released only since 20261127): undecided released matches at p_min_score+, evaluating, optional unscored and decisions since p_decided_since, plus other clients'' p_floor+ rows on the same postings; with posting columns (p_*) and the posting''s coach flags. Service role only.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify (every row true):
-- SELECT 'columns' AS check, (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posting_matches' AND column_name IN ('released_at', 'released_night', 'queue_expired_at')) = 3 AS ok
-- UNION ALL SELECT 'candidates view', to_regclass('public.client_match_candidates') IS NOT NULL
-- UNION ALL SELECT 'queue view filters released', pg_get_viewdef('public.client_match_queue'::regclass) LIKE '%released_at IS NOT NULL%'
-- UNION ALL SELECT 'release_queue', to_regprocedure('public.release_queue(integer, integer, integer, integer, timestamptz)') IS NOT NULL
-- UNION ALL SELECT 'job_queue_rows filters released', pg_get_functiondef('public.job_queue_rows(uuid[], integer, integer, boolean, timestamptz)'::regprocedure) LIKE '%released_at IS NOT NULL%'
-- UNION ALL SELECT 'step allowed', pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'pipeline_runs_step_valid')) LIKE '%queue_release%';
