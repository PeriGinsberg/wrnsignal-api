-- 20261201_queue_release_age_from_golive.sql
-- Interim, until release nights are counted (fix 1): a match that entered the
-- queue before the release went live is aged from the first release night,
-- 2026-11-10 (UTC), not from its original first_queued_at.
--
-- Why: the 20261127 backfill released only matches at 60+ at migration time.
-- A match queued earlier that reached 60+ later (re-judged after the
-- migration) kept its old first_queued_at, so the first release counted it as
-- already past its 7 nights and expired it unreleased (43 on 2026-11-10).
--
-- The change is release_queue() only, against 20261127 (with b6397f90):
-- the arrival night for the window and for expiry is
--   greatest(first_queued_at, v_anchor)
-- written so the range scans keep using posting_matches_release_pending_idx
-- (20261130). Through 2026-11-16 every pre-go-live match (back to 2026-10-11)
-- is a candidate; nothing expires before the 2026-11-16 release has run.
-- Same file for dev and prod. Safe to run again.

BEGIN;

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
  v_first_ts timestamptz := v_first::timestamp AT TIME ZONE 'UTC';
  v_next_ts timestamptz := (v_first + 1)::timestamp AT TIME ZONE 'UTC';
  v_floor_ts timestamptz := (v_today - 30)::timestamp AT TIME ZONE 'UTC';
  -- The first release night. Earlier arrivals count from here (20261201).
  v_anchor timestamptz := '2026-11-10 00:00:00+00';
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
      AND (q.first_queued_at >= v_first_ts
           OR (v_anchor >= v_first_ts AND q.first_queued_at >= v_anchor - interval '30 days' AND q.first_queued_at < v_anchor))
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
  --    unreleased after its last night, counting from greatest(arrival, anchor).
  --    While the anchor is inside the window nothing can expire, so the step is skipped.
  IF v_anchor < v_next_ts THEN
    WITH exp AS (
      UPDATE posting_matches m SET queue_expired_at = now()
      FROM client_match_candidates q
      WHERE m.id = q.match_id AND q.action IS NULL AND q.released_at IS NULL AND q.queue_expired_at IS NULL
        AND q.first_queued_at < v_next_ts
        AND q.first_queued_at >= least(v_floor_ts, v_anchor - interval '30 days')
        AND (q.score >= p_floor OR (q.score >= p_deadline_min AND q.application_deadline
              BETWEEN (greatest(q.first_queued_at, v_anchor) AT TIME ZONE 'UTC')::date
                  AND (greatest(q.first_queued_at, v_anchor) AT TIME ZONE 'UTC')::date + (p_expire_nights - 1) + 7))
      RETURNING m.client_profile_id
    )
    SELECT coalesce(jsonb_object_agg(client_profile_id, n), '{}'::jsonb) INTO v_exp
    FROM (SELECT client_profile_id, count(*) AS n FROM exp GROUP BY 1) x;
  ELSE
    v_exp := '{}'::jsonb;
  END IF;

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
  'Nightly Job Queue release (20261127; lib/pipeline/queueRelease.ts): per client at most p_limit of the p_floor+ matches (deadline within 7 days at p_deadline_min+ first), then expires matches unreleased after p_expire_nights. Matches queued before 2026-11-10 are aged from 2026-11-10 (20261201). Returns per-client released/deadline, expired, below_floor (arrived since p_since). Service role only.';

COMMIT;

-- Verify (true):
-- SELECT pg_get_functiondef('public.release_queue(integer, integer, integer, integer, timestamptz)'::regprocedure) LIKE '%v_anchor%' AS anchored;
