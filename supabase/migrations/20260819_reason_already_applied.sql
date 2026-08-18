-- Add already_applied to the lane_results dismissal taxonomy.
--
-- The set described six ways a lane could be WRONG. It had no way to say the
-- lane was right and the client simply got there first. That case was being
-- filed under right_employer_wrong_level and wrong_function — observed on
-- Annie's production lane, where three rows carry a hand-typed note saying
-- "already applied" under two different targeting-miss reasons.
--
-- WHY IT MATTERS BEYOND TIDINESS. The reasons exist to be counted: repeated
-- wrong_function means the lane's titles need fixing, repeated wrong_industry
-- means its keyword or filters do. "Already applied" is not a complaint about
-- the lane, it is the lane surfacing a job the client had already found — the
-- lane working. Counting it beside the misses makes a well-aimed lane look
-- badly aimed, and the more of them there are the worse the advice gets.
--
-- The hit/miss distinction lives in lib/laneReasons.ts, which the API and the
-- dashboard both read. The database only enforces the vocabulary; it has no
-- opinion about which values are good news.
--
-- Widening a CHECK is safe on existing rows: every stored value still satisfies
-- the new constraint, so this validates without a rewrite.
--
-- Probed before writing:
--   dev  (zydrqckpwidipwbhrfgd)  lane_results EXISTS
--   prod (ejhnokcnahauvrcbcmic)  lane_results EXISTS, 9 rows, 4 dismissed
-- APPLY TO BOTH. Prod has rows waiting to be recategorised; dev has the code
-- that will offer the new value.

ALTER TABLE public.lane_results
  DROP CONSTRAINT IF EXISTS lane_results_reason_valid;
ALTER TABLE public.lane_results
  ADD CONSTRAINT lane_results_reason_valid
  CHECK (reason IS NULL OR reason IN (
    'too_senior',
    'wrong_function',
    'wrong_industry',
    'wrong_location',
    'right_employer_wrong_level',
    'doesnt_meet_requirements',
    'already_applied'
  ));

COMMENT ON COLUMN public.lane_results.reason IS
  'Closed dismissal taxonomy; NULL for pushes. Six reasons indict the lane''s targeting — repeated wrong_function means the titles need fixing, repeated wrong_industry means the keyword or filters do. already_applied is the exception: it means the lane found a job the client had already applied to, which counts as a hit. See lib/laneReasons.ts, where each value declares its kind.';

NOTIFY pgrst, 'reload schema';
