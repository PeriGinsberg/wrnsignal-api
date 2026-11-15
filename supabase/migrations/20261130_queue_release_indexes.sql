-- 20261130_queue_release_indexes.sql
-- release_queue() (20261127) hit the statement timeout on its first prod night.
--
-- Its release and expiry steps read client_match_candidates, whose filter is
-- written cardinality(rule_failures) = 0. 20261127's posting_matches_unreleased_idx
-- is declared WHERE rule_failures = '{}'::text[]; Postgres cannot prove one
-- predicate from the other, so it never used that index and scanned every
-- undecided match (with the per-row coach-flag lookup) twice. The "already
-- released tonight" count filtered on released_night, which had no index.
--
--   posting_matches_release_pending_idx  the same rows as _unreleased_idx, in the
--                                        view's own predicate form, by arrival
--   posting_matches_released_night_idx   released rows by night and client
--
-- posting_matches_unreleased_idx stays: the below-floor count (step 3) uses it.
-- Plain CREATE INDEX (the SQL Editor runs one transaction, where CONCURRENTLY is
-- refused): a short write lock on posting_matches while it builds. Run outside
-- 05:00-08:00 UTC. Same file for dev and prod. Safe to run again.

CREATE INDEX IF NOT EXISTS posting_matches_release_pending_idx
  ON public.posting_matches (first_queued_at)
  WHERE cardinality(rule_failures) = 0 AND action IS NULL AND released_at IS NULL AND queue_expired_at IS NULL;

CREATE INDEX IF NOT EXISTS posting_matches_released_night_idx
  ON public.posting_matches (released_night, client_profile_id)
  WHERE released_night IS NOT NULL;

ANALYZE public.posting_matches;

-- Verify (both true):
-- SELECT to_regclass('public.posting_matches_release_pending_idx') IS NOT NULL AS pending_idx,
--        to_regclass('public.posting_matches_released_night_idx') IS NOT NULL AS night_idx;
--
-- Proof, nothing kept: the release under an 8s limit, rolled back. Expect a jsonb
-- result in a few seconds, not "canceling statement due to statement timeout".
-- BEGIN;
-- SET LOCAL statement_timeout = '8s';
-- SELECT public.release_queue(60, 8, 7, 50, now() - interval '1 day');
-- ROLLBACK;
