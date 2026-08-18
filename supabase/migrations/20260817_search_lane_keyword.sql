-- A lane-wide keyword, appended to every title before the query is sent.
--
-- Job titles are ambiguous across industries in a way that a lane is not.
-- "partnership marketing" returns retail, tech and healthcare partnerships
-- with equal enthusiasm; the lane only ever wanted the sports ones. Rather
-- than rewriting every title to carry the sector, the lane says it once.
--
-- This is deliberately a plain search token and not a filter on
-- v5_processed_job_data.job_category or the company's industry: the board's
-- own category is one label per job, and "sports" cuts across marketing,
-- operations and analytics categories. A keyword lets the lane narrow by
-- subject without pretending the taxonomy has an axis it does not.
--
-- NULL means "no keyword", which is every existing lane and stays the
-- behaviour of a lane that never sets one. Empty string is NOT a second way
-- to say that — the CHECK rejects it, so there is one representation of
-- "nothing to append" and the runner has one thing to test for.

ALTER TABLE public.search_lanes
  ADD COLUMN IF NOT EXISTS keyword text;

ALTER TABLE public.search_lanes
  DROP CONSTRAINT IF EXISTS search_lanes_keyword_not_blank;
ALTER TABLE public.search_lanes
  ADD CONSTRAINT search_lanes_keyword_not_blank
  CHECK (keyword IS NULL OR length(btrim(keyword)) > 0);

COMMENT ON COLUMN public.search_lanes.keyword IS
  'Appended to every title before the board query is sent ("partnership marketing" + "sports"). NULL means no keyword; empty string is rejected so there is one representation of that.';

NOTIFY pgrst, 'reload schema';
