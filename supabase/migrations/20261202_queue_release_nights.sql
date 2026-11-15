-- 20261202_queue_release_nights.sql
-- Job Queue: a match's chances are the nights the release SUCCEEDED, not
-- calendar nights (Peri, 2026-11-10). Replaces 20261201's go-live anchor.
--
-- queue_release_nights  one row per night release_queue() completed. The
--                       function writes tonight's row in its own transaction,
--                       so a release that fails (timeout, error) leaves no row
--                       and that night costs no match a chance.
--
-- A match's chances = release nights on or after its arrival night (the UTC
-- date of first_queued_at), tonight included. With N = p_expire_nights:
--   * it is a candidate tonight while it has had at most N, that is, it arrived
--     after the (N+1)th most recent release night;
--   * it expires after tonight's release when it has had N, that is, it
--     arrived on or before the Nth most recent release night.
-- A match queued before the first release night has had no chance before it,
-- so it counts from that night (20261201's anchor, now without a constant).
--
-- Everything else is 20261127 (with b6397f90): floor, limit, deadline-first,
-- unscored skipped, below-floor count. Expiry looks back 30 days as before;
-- in the first 30 days of the release it looks back to 30 days before the
-- first release night, so no pre-go-live match is left unexpired.
--
-- Seeds the nights that already released (posting_matches.released_night,
-- and ok queue_release rows in pipeline_runs). On prod that is 2026-11-10.
-- Same file for dev and prod. Safe to run again. Needs 20261130's indexes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.queue_release_nights (
  night date PRIMARY KEY,
  released_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.queue_release_nights ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.queue_release_nights FROM anon, authenticated;
COMMENT ON TABLE public.queue_release_nights IS
  'Job Queue: the UTC nights release_queue() completed (20261202). A match''s chances are these nights on or after its arrival; a failed night has no row.';

INSERT INTO public.queue_release_nights (night)
SELECT DISTINCT released_night FROM public.posting_matches WHERE released_night IS NOT NULL
UNION
SELECT DISTINCT night FROM public.pipeline_runs WHERE step = 'queue_release' AND status = 'ok'
ON CONFLICT (night) DO NOTHING;

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
  v_first_night date;  -- the first release night ever
  v_nth date;          -- the Nth most recent release night, tonight included
  v_before date;       -- the (N+1)th: arrivals on or before it are past their window
  v_from timestamptz;  -- candidates arrived at or after this
  v_exp_from timestamptz;
  v_rel jsonb;
  v_exp jsonb;
  v_below jsonb;
BEGIN
  -- Tonight counts as a chance. Rolled back with everything else if anything below fails.
  INSERT INTO queue_release_nights (night) VALUES (v_today) ON CONFLICT (night) DO NOTHING;

  SELECT min(night) INTO v_first_night FROM queue_release_nights;
  SELECT night INTO v_nth FROM queue_release_nights WHERE night <= v_today ORDER BY night DESC OFFSET p_expire_nights - 1 LIMIT 1;
  SELECT night INTO v_before FROM queue_release_nights WHERE night <= v_today ORDER BY night DESC OFFSET p_expire_nights LIMIT 1;
  -- Fewer than N+1 release nights: everything since the first is still in its
  -- window, and so is a pre-go-live match (up to 30 days before it).
  v_from := (coalesce(v_before + 1, v_first_night - 30))::timestamp AT TIME ZONE 'UTC';
  v_exp_from := (CASE WHEN v_today < v_first_night + 30 THEN v_first_night - 30 ELSE v_today - 30 END)::timestamp AT TIME ZONE 'UTC';

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
      AND q.first_queued_at >= v_from
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

  -- 2. Expire: entered (floor, or deadline-eligible since its first chance),
  --    still unreleased, and tonight was its Nth chance or later. A separate
  --    statement, so it sees step 1 (data-modifying CTEs in one statement share a snapshot).
  IF v_nth IS NULL THEN
    v_exp := '{}'::jsonb;
  ELSE
    WITH exp AS (
      UPDATE posting_matches m SET queue_expired_at = now()
      FROM client_match_candidates q
      WHERE m.id = q.match_id AND q.action IS NULL AND q.released_at IS NULL AND q.queue_expired_at IS NULL
        AND q.first_queued_at < ((v_nth + 1)::timestamp AT TIME ZONE 'UTC')
        AND q.first_queued_at >= v_exp_from
        AND (q.score >= p_floor OR (q.score >= p_deadline_min AND q.application_deadline
              BETWEEN greatest((q.first_queued_at AT TIME ZONE 'UTC')::date, v_first_night) AND v_today + 7))
      RETURNING m.client_profile_id
    )
    SELECT coalesce(jsonb_object_agg(client_profile_id, n), '{}'::jsonb) INTO v_exp
    FROM (SELECT client_profile_id, count(*) AS n FROM exp GROUP BY 1) x;
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
  'Nightly Job Queue release (20261127; lib/pipeline/queueRelease.ts): per client at most p_limit of the p_floor+ matches (deadline within 7 days at p_deadline_min+ first), then expires matches unreleased after p_expire_nights SUCCESSFUL release nights (queue_release_nights, 20261202). Returns per-client released/deadline, expired, below_floor (arrived since p_since). Service role only.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify (every row true):
-- SELECT 'table' AS check, to_regclass('public.queue_release_nights') IS NOT NULL AS ok
-- UNION ALL SELECT 'seeded', EXISTS (SELECT 1 FROM public.queue_release_nights)
-- UNION ALL SELECT 'function counts nights', pg_get_functiondef('public.release_queue(integer, integer, integer, integer, timestamptz)'::regprocedure) LIKE '%queue_release_nights%';
-- SELECT * FROM public.queue_release_nights ORDER BY night;
