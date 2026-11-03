-- 20261123_job_queue_index.sql
-- Job Queue: the index its loader reads (lib/match/jobQueue.ts loadJobQueue).
--
-- The loader no longer reads client_match_queue: that view ranks a client's
-- whole queue, judged and unjudged, before any filter, and timed out on prod.
-- It now asks posting_matches directly:
--   client_profile_id IN (...) AND rule_failures = '{}' AND score >= <min>
--   (action IS NULL, or = 'evaluating'; or score IS NULL when asked)
-- posting_matches_queue_idx cannot serve that: its predicate is
-- cardinality(rule_failures) = 0 AND action IS NULL, and the API can only say
-- rule_failures = '{}' (an equal condition the planner cannot prove from it).
-- This index's predicate is exactly what the loader sends.
--
-- Decided rows use posting_matches_actioned_idx (20261120); postings, flags and
-- links are read by primary key. Plain CREATE INDEX (a SQL-editor run is one
-- transaction, where CONCURRENTLY is refused): it holds a short write lock on
-- posting_matches while it builds. Run outside the nightly matching window.
-- Same file for dev and prod.

CREATE INDEX IF NOT EXISTS posting_matches_jobqueue_idx
  ON public.posting_matches (client_profile_id, score DESC NULLS LAST)
  WHERE rule_failures = '{}'::text[];

ANALYZE public.posting_matches;

-- Verify (one row, true):
-- SELECT to_regclass('public.posting_matches_jobqueue_idx') IS NOT NULL AS index_exists;
