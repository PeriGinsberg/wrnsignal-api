-- ═══════════════════════════════════════════════════
-- A task with a client carries its relationship too — 2026-09-29
-- ═══════════════════════════════════════════════════
--
-- IN PLAIN ENGLISH
--
-- A coaching task can be tied to a client by either of two columns, and both
-- are legitimate:
--
--   client_profile_id   the person
--   coach_client_id     the engagement, which is also the only link a
--                       prospect-era task has, written before that person had
--                       a profile at all ("Send SIGNAL invite to Eva Garcia")
--
-- Different surfaces read different columns, so a row carrying only one of them
-- is invisible to half the product. Needs Your Attention reads the
-- relationship, and a hand-written task carrying only client_profile_id never
-- appeared there.
--
-- The code now does both halves: createTask resolves coach_client_id whenever a
-- client is named, and both read paths match on either column. This backfills
-- the rows written before that.
--
-- ACTIVE RELATIONSHIP FIRST. A client can carry a revoked relationship beside a
-- live one after a coach handover, and the task belongs to the live one. Any
-- relationship beats none: a task on a revoked one still shows on the client's
-- page, which is the point.
--
-- THE OTHER DIRECTION IS DELIBERATELY NOT BACKFILLED. Tasks with only
-- coach_client_id are left alone. Filling client_profile_id from the
-- relationship would claim a prospect task was always about a person who did
-- not have a profile when it was written, and the read paths now find them
-- anyway.
--
-- Reversibility: there is no safe automatic reversal, because after this runs
-- a backfilled row is indistinguishable from one written correctly. It is
-- additive to a column that was NULL, and nothing reads it as anything other
-- than "this task belongs to that engagement".

BEGIN;

UPDATE public.coach_tasks t
SET coach_client_id = (
  SELECT cc.id FROM public.coach_clients cc
  WHERE cc.client_profile_id = t.client_profile_id
  -- coach_clients has no created_at (checked, not assumed: the first draft
  -- of this used one and Postgres refused it). id is a stable tiebreak.
  ORDER BY (cc.status = 'active') DESC, cc.id ASC
  LIMIT 1
)
WHERE t.coach_client_id IS NULL
  AND t.client_profile_id IS NOT NULL
  AND t.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.coach_clients cc WHERE cc.client_profile_id = t.client_profile_id
  );

COMMIT;

-- Verification, to run straight after:
--   SELECT count(*) FROM coach_tasks
--    WHERE deleted_at IS NULL AND client_profile_id IS NOT NULL
--      AND coach_client_id IS NULL;   -- expect 0, or only clients with no relationship

NOTIFY pgrst, 'reload schema';
