-- Review actions on lane results.
--
-- A lane keeps finding jobs; a person has to decide about each one. This adds
-- that decision to lane_results so the review queue is simply "the rows with
-- no decision yet" rather than a second table to keep in sync.
--
-- ADDITIVE. Four nullable columns, no backfill, no existing column altered.
-- Every row written by the runner so far stays valid with action NULL, which
-- is exactly what "still in the queue" means.
--
-- Probed on dev before writing: lane_results EXISTS with 70 rows, all with no
-- action columns, so this is real work and not a no-op.

ALTER TABLE public.lane_results
  ADD COLUMN IF NOT EXISTS action      text,
  ADD COLUMN IF NOT EXISTS reason      text,
  ADD COLUMN IF NOT EXISTS note        text,
  ADD COLUMN IF NOT EXISTS actioned_at timestamptz;

-- ---------------------------------------------------------------------------
-- The decision itself
-- ---------------------------------------------------------------------------
-- NULL action = unreviewed = in the queue. That is the whole state machine;
-- there is deliberately no 'pending' value, because a third name for "nobody
-- has looked at it" would let the queue disagree with itself.
ALTER TABLE public.lane_results
  DROP CONSTRAINT IF EXISTS lane_results_action_valid;
ALTER TABLE public.lane_results
  ADD CONSTRAINT lane_results_action_valid
  CHECK (action IS NULL OR action IN ('push', 'dismiss'));

-- The dismissal taxonomy is fixed and enforced here rather than only in the
-- UI. These six are the reasons a lane result actually gets rejected, and
-- keeping them closed is what makes them countable later: "wrong function"
-- appearing 40 times means the lane's titles are wrong, and that signal only
-- exists if the reason is a value rather than free text. The note column is
-- where anything outside the taxonomy goes.
ALTER TABLE public.lane_results
  DROP CONSTRAINT IF EXISTS lane_results_reason_valid;
ALTER TABLE public.lane_results
  ADD CONSTRAINT lane_results_reason_valid
  CHECK (reason IS NULL OR reason IN (
    'too_senior',
    'wrong_function',
    'wrong_location',
    'wrong_employer',
    'right_employer_wrong_level',
    'doesnt_meet_requirements'
  ));

-- A dismissal without a reason is the thing that makes the taxonomy useless,
-- so the database refuses it rather than trusting every caller to remember.
-- A push carries no reason at all: reusing the dismissal vocabulary to explain
-- an approval would quietly corrupt the counts above.
ALTER TABLE public.lane_results
  DROP CONSTRAINT IF EXISTS lane_results_reason_matches_action;
ALTER TABLE public.lane_results
  ADD CONSTRAINT lane_results_reason_matches_action
  CHECK (
    (action = 'dismiss' AND reason IS NOT NULL) OR
    (action = 'push'    AND reason IS NULL)     OR
    (action IS NULL     AND reason IS NULL)
  );

-- An actioned row must say when, and an unactioned row must not pretend to.
ALTER TABLE public.lane_results
  DROP CONSTRAINT IF EXISTS lane_results_actioned_at_matches_action;
ALTER TABLE public.lane_results
  ADD CONSTRAINT lane_results_actioned_at_matches_action
  CHECK ((action IS NULL) = (actioned_at IS NULL));

-- ---------------------------------------------------------------------------
-- The queue's access path
-- ---------------------------------------------------------------------------
-- Partial on action IS NULL: the review page asks this one question, and the
-- unactioned set shrinks as the queue is worked while the actioned set only
-- grows. Indexing the part that is being read is the point.
CREATE INDEX IF NOT EXISTS idx_lane_results_queue
  ON public.lane_results (lane_id, posted_at DESC)
  WHERE action IS NULL;

COMMENT ON COLUMN public.lane_results.action IS
  'push | dismiss. NULL means unreviewed — this is what puts a row in the review queue.';
COMMENT ON COLUMN public.lane_results.reason IS
  'Closed dismissal taxonomy; NULL for pushes. Fixed so rejections stay countable — repeated "wrong_function" means the lane titles need fixing.';
COMMENT ON COLUMN public.lane_results.note IS
  'Optional free text from the reviewer. The escape hatch for anything the reason list does not cover.';

NOTIFY pgrst, 'reload schema';
