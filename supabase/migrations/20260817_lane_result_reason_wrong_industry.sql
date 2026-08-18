-- Add wrong_industry to the lane_results dismissal taxonomy.
--
-- The set was missing the case where the function and level are both right
-- and the sector is not — a marketing coordinator role at a company in an
-- industry the candidate is not targeting. That was previously being absorbed
-- by wrong_function or wrong_employer, which is worse than it sounds: the
-- reasons exist to be counted, and a rejection filed under the wrong heading
-- points the next lane edit at the wrong knob. Repeated wrong_function says
-- fix the TITLES; repeated wrong_industry says fix the employer filters.
--
-- Widening a CHECK is safe on existing rows: every stored value still
-- satisfies the new constraint, so this validates without a rewrite and
-- without touching the 70 rows currently in the table.

ALTER TABLE public.lane_results
  DROP CONSTRAINT IF EXISTS lane_results_reason_valid;
ALTER TABLE public.lane_results
  ADD CONSTRAINT lane_results_reason_valid
  CHECK (reason IS NULL OR reason IN (
    'too_senior',
    'wrong_function',
    'wrong_industry',
    'wrong_location',
    'wrong_employer',
    'right_employer_wrong_level',
    'doesnt_meet_requirements'
  ));

COMMENT ON COLUMN public.lane_results.reason IS
  'Closed dismissal taxonomy; NULL for pushes. Fixed so rejections stay countable — repeated "wrong_function" means the lane titles need fixing, repeated "wrong_industry" means the employer filters do.';

NOTIFY pgrst, 'reload schema';
