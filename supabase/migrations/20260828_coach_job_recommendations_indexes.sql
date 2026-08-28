-- Indexes for coach_job_recommendations.
--
-- The table has had none since it was created in 20260413_coach_client_system.sql:
-- a primary key on id, and six foreign keys. Postgres indexes the REFERENCED
-- side of a foreign key, never the referencing column, so client_profile_id,
-- coach_profile_id, client_status, client_responded_at and notification_seen
-- were all unindexed. Every query that filtered on them scanned the whole table.
--
-- WHY IT SHOWS UP ON THE COACHES CENTER. /api/coach/home queries this table
-- TWICE PER CLIENT, inside the per-client fan-out that builds the landing
-- cards: once for pending recommendations and once for responses since the
-- coach's last visit. /api/coach/clients queries it once more per client. So a
-- coach with forty clients triggers on the order of a hundred and twenty full
-- scans of this table to render one page. Nothing about that is visible in the
-- code, which reads as three ordinary filtered lookups.
--
-- ---------------------------------------------------------------------------
-- Why two indexes and not one
-- ---------------------------------------------------------------------------
-- The access paths come in two shapes, and one composite cannot serve both.
--
-- COACH SIDE, always the pair (coach_profile_id, client_profile_id):
--   /api/coach/home                        + client_status = 'new'
--   /api/coach/home                        + client_responded_at > baseline
--   /api/coach/clients                     + client_status = 'new'
--   /api/coach/clients/[id]/tracker        ORDER BY created_at DESC
--   /api/coach/clients/[id]/since-last-visit + client_responded_at > baseline
--   _lib/coachEngagementHeuristics         client_profile_id IN (...)
--
-- CLIENT SIDE, client_profile_id alone, with no coach in the predicate:
--   /api/coach/my-recommendations          ORDER BY created_at DESC
--   /api/coach/notifications               + notification_seen = false
--   /api/coach/notifications/mark-seen     + notification_seen = false
--
-- A composite led by coach_profile_id cannot answer the second group: an index
-- is only usable from its leading column, and those queries never mention a
-- coach. Hence a second index led by client_profile_id, which the coach-side
-- IN (...) lookups can also use.
--
-- The third column is created_at DESC in both, matching the ORDER BY the
-- tracker and the client's own list already ask for. It is not there for
-- selectivity: once the leading columns have narrowed to one coach-client pair
-- the remaining rows are a handful, and the extra predicates (client_status,
-- client_responded_at, notification_seen) filter that handful for free. Adding
-- columns for those would buy nothing and cost write throughput on a table
-- every recommendation insert touches.
--
-- ---------------------------------------------------------------------------
-- Applying this
-- ---------------------------------------------------------------------------
-- Not probed against a live database before writing: this session has no
-- credentials. Both statements are IF NOT EXISTS, so re-running is a no-op, and
-- an index is invisible to application code, so there is nothing to coordinate
-- with a deploy. It can be applied before, after, or without one.
--
-- A plain CREATE INDEX takes a SHARE lock and blocks writes to the table while
-- it builds, which is milliseconds on a table of this size. Check first:
--
--   SELECT count(*) FROM public.coach_job_recommendations;
--
-- If that is into the hundreds of thousands, run these as
-- CREATE INDEX CONCURRENTLY instead, one statement at a time and outside any
-- transaction. CONCURRENTLY does not block writes but cannot run in a
-- transaction block and leaves an INVALID index behind if it fails, which is a
-- worse trade at small scale than a lock nobody notices.

CREATE INDEX IF NOT EXISTS idx_coach_job_recommendations_coach_client
  ON public.coach_job_recommendations (coach_profile_id, client_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_coach_job_recommendations_client
  ON public.coach_job_recommendations (client_profile_id, created_at DESC);

COMMENT ON INDEX public.idx_coach_job_recommendations_coach_client IS
  'Coach-side lookups, which always filter on the (coach, client) pair: the landing fan-out, the clients list, the tracker and since-last-visit. Before this the table had no index but its primary key and every one of those scanned it whole, once per client per page load.';

COMMENT ON INDEX public.idx_coach_job_recommendations_client IS
  'Client-side lookups, which name no coach: my-recommendations and the notification queries. The coach-side composite cannot serve these, because an index is only usable from its leading column.';

NOTIFY pgrst, 'reload schema';
