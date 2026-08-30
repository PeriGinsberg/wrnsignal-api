-- days_posted holds a board token, not a number of days. Correcting the five
-- values, which is why every lane has been returning postings from 2016.
--
-- WHAT WENT WRONG. 20260827_lane_posting_window.sql read the hardcoded 29 in
-- laneRunner as "29 days", called it arbitrary, and replaced it with a closed
-- set of honest day counts: 1, 3, 7, 14, 30. But hiring.cafe's
-- dateFetchedPastNDays is not a day count. It is a token from a closed list its
-- own Date Posted control defines:
--
--     All time -1, 24 hours 2, 3 days 4, 1 week 14, 2 weeks 21, 3 weeks 29,
--     1 month 61, 2 months 91, 3 months 121, ... 3 years 1440
--
-- The 29 was that list's "3 weeks". Nothing about it was arbitrary; it was the
-- one value in the old set the board actually recognised.
--
-- The board does not reject a token outside the list. It answers HTTP 200 and
-- applies no date filter whatsoever. Measured against the live endpoint on
-- 2026-08-30, one query: token 14 returned 7303 results reaching back 13 days;
-- 1, 3, 7 and 30 each returned 28101 reaching back 1447 days, identical to
-- asking for "All time". So of the five values this table has been storing
-- since 2026-08-27, four switched the filter off, and the fifth (14) was
-- labelled "2 weeks" while asking the board for its "1 week".
--
-- Every existing lane was backfilled to 30 by that migration, so every lane has
-- been running unfiltered. The queue got bigger, which is the failure nobody
-- reports.
--
-- THE REMAP KEEPS THE LABEL THE COACH CHOSE, and moves it onto the token that
-- actually delivers it:
--
--      1 "24 hours"  ->   2    the board's "24 hours"
--      3 "3 days"    ->   4    the board's "3 days"
--      7 "1 week"    ->  14    the board's "1 week"
--     14 "2 weeks"   ->  21    the board's "2 weeks"
--     30 "30 days"   ->  61    the board's "1 month", the nearest it offers
--
-- 30 is the ambiguous one: it is both the value backfilled onto every lane that
-- predates the column and the value a coach picked from a dropdown reading
-- "30 days". It maps to 61 because that is what the dropdown promised, and
-- because 61 narrows a backfilled lane from four years to two months either
-- way. A lane that wants tighter now has four narrower choices that work.
--
-- ONE STATEMENT, NOT FIVE. Sequential updates would cascade: 7 -> 14 followed
-- by 14 -> 21 lands the week-old lanes on a fortnight. The CASE reads every row
-- once against its original value.
--
-- The ELSE is deliberately a pass-through rather than a default. The old CHECK
-- makes it unreachable; if a value outside the five is somehow present, the new
-- CHECK below rejects it and the transaction fails, which is the outcome worth
-- having. Stamping a default over it would repeat this whole bug quietly.
--
-- Not probed against a live database before writing. Apply to dev and prod
-- together with the code: until both are in place, prod stores tokens the
-- runner will now throw on, and that is by design (see buildSearchState).

BEGIN;

ALTER TABLE public.search_lanes
  DROP CONSTRAINT IF EXISTS search_lanes_days_posted_valid;

UPDATE public.search_lanes
SET days_posted = CASE days_posted
    WHEN 1  THEN 2
    WHEN 3  THEN 4
    WHEN 7  THEN 14
    WHEN 14 THEN 21
    WHEN 30 THEN 61
    ELSE days_posted
  END
WHERE days_posted IN (1, 3, 7, 14, 30);

ALTER TABLE public.search_lanes
  ALTER COLUMN days_posted SET DEFAULT 21;

ALTER TABLE public.search_lanes
  ADD CONSTRAINT search_lanes_days_posted_valid
  CHECK (days_posted IN (2, 4, 14, 21, 61));

COMMENT ON COLUMN public.search_lanes.days_posted IS
  'hiring.cafe Date Posted TOKEN, sent verbatim as dateFetchedPastNDays. NOT a number of days: 2 = 24 hours, 4 = 3 days, 14 = 1 week, 21 = 2 weeks, 61 = 1 month. A value outside the board''s own list is not rejected by the board — it drops the date filter entirely and returns everything it has ever fetched. Closed set, in step with lib/lanePostingWindow.ts. Lanes that predate the column ran at 29, the board''s "3 weeks".';

COMMIT;

NOTIFY pgrst, 'reload schema';
