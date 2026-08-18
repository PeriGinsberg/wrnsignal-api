-- Retire wrong_employer; fold it into wrong_industry.
--
-- WHY IT GOES. The reason was meant for "this specific employer is not one I
-- would work for", a durable fact about a company. In practice it collected
-- "this company is in a sector I am not targeting", which is a fact about the
-- QUERY, not the employer. The dev lane made that unambiguous: 40 dismissals
-- spread across 37 companies, maximum count 2. A reason nobody ever files
-- twice against the same company is not identifying employers — it is
-- absorbing industry mismatch, and the counts were pointing at a blocklist
-- when the real fix was the lane's titles and keyword.
--
-- Six reasons that each mean one thing beat seven where two overlap. If a
-- genuine per-employer veto is wanted later it belongs in the lane's
-- exclusions.companies allowlist, which is enforcement rather than an
-- after-the-fact label.
--
-- ORDER IS LOAD BEARING. The UPDATE must run BEFORE the constraint is
-- narrowed. Postgres validates a new CHECK against every existing row, so
-- narrowing first would fail outright on the rows still holding the retired
-- value. Both statements run in one transaction, so a failure leaves neither
-- applied rather than a half-migrated table.

BEGIN;

-- Idempotent: a second run matches nothing.
UPDATE public.lane_results
   SET reason = 'wrong_industry'
 WHERE reason = 'wrong_employer';

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
    'doesnt_meet_requirements'
  ));

COMMIT;

COMMENT ON COLUMN public.lane_results.reason IS
  'Closed dismissal taxonomy; NULL for pushes. Fixed so rejections stay countable — repeated "wrong_function" means the lane titles need fixing, repeated "wrong_industry" means the keyword or titles are pulling the wrong sector. Per-employer vetoes belong in search_lanes.exclusions, not here.';

NOTIFY pgrst, 'reload schema';
