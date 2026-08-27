-- The lane's posting window: how far back one run looks.
--
-- It was 29 days, a constant in lib/laneRunner.ts repeated in the CLI and in
-- the title-discovery route. A fixed month is wrong in both directions. A busy
-- market wants a queue of what appeared since yesterday, because everything
-- older has already been worked; a thin one needs every posting still live,
-- because three days of a niche search is an empty screen. Neither is sayable
-- while the number is a constant, and the coach who needs to say it is the one
-- looking at the queue.
--
-- WHY A COLUMN RATHER THAN location.days_posted. The runner already read that
-- key as a fallback and nothing ever wrote it: a shape waiting for a meaning.
-- A posting window is also not a location, and burying it there costs the
-- CHECK, the default, and the visibility of a column missing from a select
-- list. That last one is not hypothetical. `filters` was left out of one such
-- list and every nightly run silently applied no board filters at all.
--
-- WHY A CLOSED SET. The same reason the dismissal reasons are closed: these
-- five are offered as choices and each has been reasoned about. An arbitrary
-- integer would let a lane sit at 400 days, and the board accepts that in
-- silence. Must stay in step with lib/lanePostingWindow.ts.
--
-- EXISTING LANES KEEP THEIR BEHAVIOUR, at 30 rather than the 29 they ran at.
-- The old number is the arbitrary one, a day short of a month with no reason
-- recorded for it anywhere, and carrying it forward would mean a permanent
-- sixth option whose only job is to preserve that. One extra day of postings
-- is not a change anyone can see; a sixth choice in every dropdown is.
--
-- NEW LANES DEFAULT TO 14. Two weeks is the window where a posting is still
-- worth applying to. The default lives on the column rather than in the create
-- route so a lane inserted by a script gets the same answer as one created
-- from the dashboard.
--
-- ORDER IS LOAD BEARING. Add nullable, backfill, then set the default and the
-- NOT NULL. Adding the column WITH its default would stamp 14 on every lane
-- that already exists, quietly narrowing every queue in the database. One
-- transaction, so a failure leaves none of it applied.
--
-- Not probed against a live database before writing. Apply to dev and prod
-- together; both are additive and safe on an empty search_lanes.

BEGIN;

ALTER TABLE public.search_lanes
  ADD COLUMN IF NOT EXISTS days_posted integer;

-- Idempotent: a second run matches nothing, because the column is NOT NULL by
-- the time this statement has run once.
UPDATE public.search_lanes SET days_posted = 30 WHERE days_posted IS NULL;

ALTER TABLE public.search_lanes
  ALTER COLUMN days_posted SET DEFAULT 14,
  ALTER COLUMN days_posted SET NOT NULL;

ALTER TABLE public.search_lanes
  DROP CONSTRAINT IF EXISTS search_lanes_days_posted_valid;
ALTER TABLE public.search_lanes
  ADD CONSTRAINT search_lanes_days_posted_valid
  CHECK (days_posted IN (1, 3, 7, 14, 30));

COMMENT ON COLUMN public.search_lanes.days_posted IS
  'How far back one run looks, in days: 1, 3, 7, 14 or 30. Sent to the board as dateFetchedPastNDays. Closed set, in step with lib/lanePostingWindow.ts. 30 on lanes that predate the column, which ran at a hardcoded 29.';

COMMIT;

NOTIFY pgrst, 'reload schema';
