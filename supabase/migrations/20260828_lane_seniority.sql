-- Which seniority bands a lane searches.
--
-- It was not a setting. lib/laneRunner.ts exported LANE_SENIORITY as the bottom
-- three bands, hardcoded, and every lane for every client searched all three:
-- No Prior Experience Required, Entry Level and Mid Level.
--
-- WHY THAT IS A BUG AND NOT A DEFAULT. A lane built for a mid-career client was
-- structurally guaranteed to return entry-level and no-experience postings, in
-- volume, with no way to stop it. That is a large share of why a first run can
-- put hundreds of jobs in a review queue. It also made "too junior" a dismissal
-- a reviewer could record and then do nothing about: the reason named a real
-- targeting failure, and the only thing that could have fixed it was a constant
-- in a source file.
--
-- WHY A COLUMN AND NOT A KEY IN `filters`. Seniority is genuinely a board-side
-- filter and sits beside the others in searchState, so `filters` looks like the
-- obvious home. It is the wrong one. Every key in that object means "empty list
-- = no restriction on this axis", and the runner enforces that by omitting an
-- empty filter from searchState entirely. Seniority cannot mean that:
-- buildSearchState always sends seniorityLevel, so an empty array reaches the
-- board as a filter matching nothing rather than as an absent one. A key whose
-- empty value means the opposite of every other key in the same object is a
-- trap, so it gets a column with its own rule.
--
-- EXISTING LANES ARE UNCHANGED. The default is exactly the three bands the
-- constant held, so ADD COLUMN with a default preserves current behaviour on
-- every row. That is why this needs none of the add-nullable-then-backfill
-- care that days_posted did: there, the default differed from what existing
-- lanes were doing.
--
-- The containment check is `<@` rather than a subquery because CHECK constraints
-- cannot contain subqueries. jsonb array containment ignores order and
-- duplicates, which is the right reading here.

ALTER TABLE public.search_lanes
  ADD COLUMN IF NOT EXISTS seniority jsonb NOT NULL
  DEFAULT '["No Prior Experience Required", "Entry Level", "Mid Level"]'::jsonb;

ALTER TABLE public.search_lanes
  DROP CONSTRAINT IF EXISTS search_lanes_seniority_valid;
ALTER TABLE public.search_lanes
  ADD CONSTRAINT search_lanes_seniority_valid
  CHECK (
    jsonb_typeof(seniority) = 'array'
    AND jsonb_array_length(seniority) >= 1
    AND seniority <@ '["No Prior Experience Required", "Entry Level", "Mid Level", "Senior Level"]'::jsonb
  );

COMMENT ON COLUMN public.search_lanes.seniority IS
  'Board seniority bands this lane searches. At least one, drawn from the four hiring.cafe accepts. Empty is refused rather than meaning "no restriction", because seniorityLevel is always sent and an empty list matches nothing. Defaults to the three bands every lane used to search. In step with lib/laneSeniority.ts.';

NOTIFY pgrst, 'reload schema';
