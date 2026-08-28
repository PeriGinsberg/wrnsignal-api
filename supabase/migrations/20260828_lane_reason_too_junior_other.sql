-- Two more ways a lane result gets dismissed: too_junior, and other.
--
-- TOO_JUNIOR closes an asymmetry. The taxonomy could say a posting was too
-- senior and could say right employer, wrong level, but had no way to say the
-- lane is surfacing work beneath the client. That is a real and differently
-- actionable miss: the runner searches the bottom three seniority bands
-- (LANE_SENIORITY in lib/laneRunner.ts), so a lane repeatedly returning work
-- that is too junior is a lane whose band or titles are set for someone earlier
-- in their career than the client is. Filing that under too_senior's opposite
-- was impossible, so it was going into wrong_function and quietly indicting the
-- titles for the wrong reason.
--
-- OTHER is the escape hatch, and it is deliberately the only value in the list
-- that says nothing about the lane. Reviewers need somewhere to put a dismissal
-- that the six targeting reasons genuinely do not describe, and without one they
-- pick the closest wrong answer instead. A reason picked because it was nearest
-- is worse than no reason: it is indistinguishable from a real signal in the
-- counts, and the counts are the entire purpose of a closed taxonomy.
--
-- WHICH IS WHY OTHER MUST CARRY A NOTE. An unexplained "other" is a dismissal
-- nobody can ever learn anything from, and it is the value most likely to be
-- picked in a hurry. The database refuses it, on the same principle that already
-- refuses a dismissal with no reason at all: the API checks it too, so the
-- caller gets a clean 400 rather than a constraint violation, but the guarantee
-- lives here where no caller can forget it.
--
-- Widening a CHECK is safe on existing rows. The new note constraint is not a
-- widening, but no existing row can violate it: 'other' has never been a legal
-- value, so nothing is stored with it.

BEGIN;

ALTER TABLE public.lane_results
  DROP CONSTRAINT IF EXISTS lane_results_reason_valid;
ALTER TABLE public.lane_results
  ADD CONSTRAINT lane_results_reason_valid
  CHECK (reason IS NULL OR reason IN (
    'too_senior',
    'too_junior',
    'wrong_function',
    'wrong_industry',
    'wrong_location',
    'right_employer_wrong_level',
    'doesnt_meet_requirements',
    'already_applied',
    'other'
  ));

-- IS DISTINCT FROM, not <>: a NULL reason must pass this, and NULL <> 'other'
-- evaluates to NULL, which a CHECK treats as satisfied only by accident. Saying
-- it explicitly beats relying on that.
ALTER TABLE public.lane_results
  DROP CONSTRAINT IF EXISTS lane_results_other_needs_note;
ALTER TABLE public.lane_results
  ADD CONSTRAINT lane_results_other_needs_note
  CHECK (
    reason IS DISTINCT FROM 'other'
    OR (note IS NOT NULL AND length(btrim(note)) > 0)
  );

COMMENT ON COLUMN public.lane_results.reason IS
  'Closed dismissal taxonomy; NULL for pushes and clears. Most values indict the lane''s targeting and are meant to be counted: repeated wrong_function means the titles need fixing, repeated too_junior or too_senior means the level does. already_applied is a hit, the lane finding a job the client already had. other is neither, and must carry a note. See lib/laneReasons.ts, where each value declares its kind.';

COMMIT;

NOTIFY pgrst, 'reload schema';
