-- Emptying a queue without claiming it was reviewed.
--
-- A lane left alone for a month greets its coach with a hundred unreviewed
-- rows, most of them roles that are filled by now. The only ways out today are
-- judging every row one at a time or deleting the lane, and deleting the lane
-- throws away the review history, which is the one thing worth keeping.
--
-- WHY NOT SIMPLY DELETE THE UNREVIEWED ROWS. They would come straight back.
-- The runner upserts on (lane_id, job_id), so the next run re-fetches every
-- posting still live inside the lane's window and re-inserts the deleted ones
-- with a fresh first_seen_at, landing them back in the queue. A clear that
-- deletes appears to work until the next morning. Keeping the row is what
-- makes the clear stick: the upsert refreshes it in place, and it stays out of
-- the queue because it has an action.
--
-- WHY A THIRD ACTION RATHER THAN A BULK DISMISS. The reasons exist to be
-- counted. Forty wrong_function dismissals mean the lane's titles need fixing,
-- and a bulk clear filed under any reason would put forty imaginary
-- judgements into that count and point at a lane that was never diagnosed.
-- 'cleared' carries no reason, like a push, so it cannot enter those counts,
-- and it stays distinguishable from a row a person actually looked at.
--
-- ACTIONED ROWS ARE NOT TOUCHED, here or by the route: the update filters on
-- action IS NULL, which is also what makes running it twice a no-op.
--
-- Both statements widen an existing CHECK, so every stored row already
-- satisfies the new one and this validates without a rewrite.

ALTER TABLE public.lane_results
  DROP CONSTRAINT IF EXISTS lane_results_action_valid;
ALTER TABLE public.lane_results
  ADD CONSTRAINT lane_results_action_valid
  CHECK (action IS NULL OR action IN ('push', 'dismiss', 'cleared'));

-- A push and a clear both carry no reason. Only a dismissal must name one,
-- because only a dismissal is counted against the lane's targeting.
ALTER TABLE public.lane_results
  DROP CONSTRAINT IF EXISTS lane_results_reason_matches_action;
ALTER TABLE public.lane_results
  ADD CONSTRAINT lane_results_reason_matches_action
  CHECK (
    (action = 'dismiss'                 AND reason IS NOT NULL) OR
    (action IN ('push', 'cleared')      AND reason IS NULL)     OR
    (action IS NULL                     AND reason IS NULL)
  );

COMMENT ON COLUMN public.lane_results.action IS
  'push | dismiss | cleared. NULL means unreviewed, which is what puts a row in the review queue. cleared is the bulk exit: nobody judged the job, the queue was emptied. The row is kept rather than deleted so the next run refreshes it in place instead of re-queueing it.';

NOTIFY pgrst, 'reload schema';
