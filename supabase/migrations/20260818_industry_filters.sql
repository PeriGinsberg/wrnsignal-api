-- Industry and company-keyword filters: on the profile, and on the lane.
--
-- WHY THESE ARE NOT MORE `exclusions`. search_lanes.exclusions holds rules we
-- apply AFTER the fetch, in our own code, against rows the board already sent.
-- Everything added here is the opposite: it is pushed INTO searchState so the
-- board never sends the rows at all. Same word, different machine, and putting
-- them in one column would leave nobody able to tell which is which. Hence a
-- separate `filters` column, whose contract is "these go to the board".
--
-- WHY INDUSTRIES LIVE ON THE PROFILE TOO. "Not education" is a fact about the
-- client, not about one search. A client who does not want school jobs does not
-- want them in any lane, and re-typing that per lane is how two lanes for the
-- same person come to disagree. Lanes inherit at creation and can then be
-- edited, because inheritance is a starting point, not a binding.
--
-- VALUES ARE BOARD LABELS, matched loosely. Sampled from 356 stored
-- lane_results, 225 distinct labels are in use, so this is an open vocabulary
-- rather than a closed taxonomy and cannot be a CHECK constraint.
--
-- CORRECTION 2026-08-18, after this migration was applied: the paragraph here
-- originally said values are EXACT matches and that excluding "Education" would
-- not exclude "Higher Education". That was asserted without testing and is
-- wrong. Measured against the live endpoint, a SINGLE-word term matches any
-- label containing a word starting with it, case-insensitively — ["Education"]
-- and even ["Educ"] both drop Higher Education employers — while a MULTI-word
-- term must equal a whole label, so "Higher Education" matches and "Higher Ed"
-- matches nothing. Mid-word substrings never match. Nothing in the DDL depends
-- on this; only the advice did.
--
-- Probed before writing (dev, zydrqckpwidipwbhrfgd):
--   client_profiles           EXISTS
--   client_profiles.target_industries    ABSENT (42703)
--   client_profiles.excluded_industries  ABSENT (42703)
--   search_lanes              EXISTS, 5 rows
--   search_lanes.filters      ABSENT (42703)

-- ---------------------------------------------------------------------------
-- 1. The profile's standing preference
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_profiles
  ADD COLUMN IF NOT EXISTS target_industries   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS excluded_industries jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Arrays, not the comma-separated text the older targeting columns use. These
-- values must match board labels character for character, and a parser sitting
-- between the coach and an exact-match filter is a source of silent misses.
ALTER TABLE public.client_profiles
  DROP CONSTRAINT IF EXISTS client_profiles_target_industries_is_array;
ALTER TABLE public.client_profiles
  ADD CONSTRAINT client_profiles_target_industries_is_array
  CHECK (jsonb_typeof(target_industries) = 'array');

ALTER TABLE public.client_profiles
  DROP CONSTRAINT IF EXISTS client_profiles_excluded_industries_is_array;
ALTER TABLE public.client_profiles
  ADD CONSTRAINT client_profiles_excluded_industries_is_array
  CHECK (jsonb_typeof(excluded_industries) = 'array');

COMMENT ON COLUMN public.client_profiles.target_industries IS
  'Exact hiring.cafe industry labels this client wants. Lanes inherit at creation. Empty = no restriction, never "match nothing".';
COMMENT ON COLUMN public.client_profiles.excluded_industries IS
  'Exact hiring.cafe industry labels this client does not want, in any lane. Lanes inherit at creation.';

-- ---------------------------------------------------------------------------
-- 2. The lane's board-side filters
-- ---------------------------------------------------------------------------
-- One object rather than four columns: they are passed to searchState as a
-- group, nothing sorts or filters on them, and a fifth board filter later is a
-- key rather than a migration.
--
--   {
--     "industries":                ["Sports", "Professional Sports"],
--     "excluded_industries":       ["Higher Education", "Education"],
--     "company_keywords":          ["sports"],
--     "excluded_company_keywords": ["university", "college"]
--   }
--
-- Every key is optional and an absent key means "no restriction on this axis" —
-- the same reading as the empty companies allowlist, and never "match nothing".
ALTER TABLE public.search_lanes
  ADD COLUMN IF NOT EXISTS filters jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.search_lanes
  DROP CONSTRAINT IF EXISTS search_lanes_filters_is_object;
ALTER TABLE public.search_lanes
  ADD CONSTRAINT search_lanes_filters_is_object
  CHECK (jsonb_typeof(filters) = 'object');

COMMENT ON COLUMN public.search_lanes.filters IS
  'Board-side filters pushed into searchState: industries, excluded_industries, company_keywords, excluded_company_keywords. Distinct from `exclusions`, which we apply ourselves after the fetch.';

NOTIFY pgrst, 'reload schema';
