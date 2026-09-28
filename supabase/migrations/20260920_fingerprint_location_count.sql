-- ===========================================================================
-- QUEUED FOR PROD. NOT URGENT. NOT YET APPLIED.   (queued 2026-09-24)
--
-- IN PLAIN ENGLISH
--
-- Every posting gets a fingerprint -- a hash of its title, company and
-- location -- and that is how we decide "we have seen this job before". Two
-- rows with the same fingerprint are treated as one posting.
--
-- Workday does something none of the other job boards do. When one job is
-- open in several offices, it does not list the offices. It returns the text
-- "2 Locations" or "20 Locations" in the location field. That is a COUNT, not
-- a place.
--
-- Right now that count goes into the fingerprint as if it were an address. So
-- every multi-site Capital One job shares the location "2 locations", and two
-- of them with the same job title would hash identically -- and one would
-- silently overwrite the other. We would lose a real job and never know.
--
-- This migration makes a count-shaped location count as NO location, which is
-- the honest reading: Workday told us how many offices, not which ones, so we
-- know no more than if the field had been empty. The original "2 Locations"
-- text is still stored and still displayed; only the matching key changes.
--
-- WHY IT IS SAFE TO WAIT
--   Prod has no Workday postings at all, so there is nothing on prod with a
--   count-shaped location and this migration would change zero rows today.
--
-- WHY IT SHOULD NOT WAIT FOREVER
--   The TypeScript code already applies this rule (it has to, to batch the
--   writes safely). Prod's database does not. They disagree in a branch that
--   nothing currently reaches. The moment Workday ingest points at prod, they
--   would disagree about real rows -- and a disagreement about fingerprints is
--   a disagreement about which postings are the same posting.
--
-- RUN IT BEFORE any Workday board is added to prod's ingest_boards.
--
-- ONE THING TO KNOW BEFORE RUNNING IT: this rebuilds the fingerprint column on
-- the whole postings table and re-adds the unique constraint. That fails if
-- the new rule merges two rows that were previously distinct. On dev it
-- changed 32 rows and merged none. Re-run that check against prod first --
-- tests/ingest/fingerprint-parity.ts, plus the collision count.
-- ===========================================================================

-- 20260920_fingerprint_location_count.sql
-- A location that is a COUNT is not a location.
--
-- WHAT PROMPTED IT. Workday's CXS list endpoint returns locationsText, and for
-- a multi-site posting that field is literally "2 Locations" or "20 Locations"
-- rather than a place. On the first 86-posting Workday run, 37% of rows came
-- back that way. Those strings flowed straight into the fingerprint, so
-- "capitalone|2 locations" became a single location key shared by 9 distinct
-- titles. They stayed distinct only because their titles differed; two
-- genuinely different multi-site postings with the same title would have
-- collapsed into one row and one of them would have been silently lost.
--
-- Greenhouse and SmartRecruiters both return real place strings, so this is
-- Workday-shaped. It is fixed in the SHARED normalizer anyway, because
-- ingest_norm_location is a generated-column expression over title, company and
-- location and cannot know which adapter produced the row. That is acceptable
-- on its merits: no real place is named "3 Locations", so the rule is safe for
-- every source rather than merely harmless for the others.
--
-- ABSENT, NOT EMPTY-STRING-AS-A-PLACE. The function already returns '' for NULL
-- and for blank input, so a count-shaped value now takes the same path and a
-- multi-site posting fingerprints as though it stated no location. That is the
-- honest reading: Workday told us how many places, not which, so we know the
-- posting's location no better than if the field were missing.
--
-- THE RAW VALUE IS NOT TOUCHED. postings.location still stores "2 Locations"
-- exactly as the source gave it, and raw keeps the whole payload. Only the
-- normalized form used for identity changes, which is the same split the
-- schema already makes for "Macy's, Inc." displaying as itself while matching
-- as "macy s inc".
--
-- ---------------------------------------------------------------------------
-- THIS IS A DATA MIGRATION, NOT A FUNCTION CHANGE
-- ---------------------------------------------------------------------------
-- 20260918_ingest_schema.sql says so explicitly: editing a normalization
-- function does NOT recompute fingerprints already stored, because the column
-- is GENERATED ... STORED. The rebuild below is the recipe that file prescribes,
-- and it can fail on postings_fingerprint_unique if the new rule merges rows the
-- old one kept apart.
--
-- CHECKED BEFORE WRITING THIS, on dev's 1,034 postings:
--     fingerprint changes : 32   (all source=workday)
--     collisions under the new rule : 0
-- So the rebuild is safe there. RUN THE SAME CHECK AGAINST PROD BEFORE APPLYING
-- IT THERE -- prod holds 6,495 postings including 469 SmartRecruiters rows that
-- dev does not, and a collision there would abort this migration midway.
-- tests/ingest/fingerprint-parity.ts is the check, and the dry-run that counts
-- collisions is in the same shape.

-- ---------------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_norm_location(v text)
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  cleaned text;
  parts   text[];
  kept    text[] := '{}';
  p       text;
  state   text;
  city    text;
BEGIN
  IF v IS NULL OR btrim(v) = '' THEN
    RETURN '';
  END IF;

  -- A COUNT IS NOT A PLACE. "2 Locations", "20 Locations", "1 Location".
  -- Treated exactly like a missing location: we were told how many, not which.
  IF btrim(v) ~* '^[0-9]+\s+locations?$' THEN
    RETURN '';
  END IF;

  -- "(+3 others)" is a multi-site marker Google Jobs appends, not a place.
  cleaned := regexp_replace(lower(btrim(v)), '\(\s*\+?\s*\d+\s+others?\s*\)', ' ', 'g');

  parts := string_to_array(cleaned, ',');
  FOREACH p IN ARRAY parts LOOP
    p := btrim(p);
    IF p <> '' THEN
      kept := kept || p;
    END IF;
  END LOOP;

  IF array_length(kept, 1) IS NULL THEN
    RETURN public.ingest_norm_text(v);
  END IF;

  -- Drop trailing country tokens, however many are stacked.
  WHILE array_length(kept, 1) >= 1
        AND btrim(kept[array_length(kept, 1)]) IN (
          'united states', 'united states of america', 'usa', 'u s a', 'u.s.a.',
          'us', 'u s', 'u.s.', 'america'
        )
  LOOP
    kept := kept[1 : array_length(kept, 1) - 1];
  END LOOP;

  -- Stripping the country left nothing, so the country WAS the location.
  IF array_length(kept, 1) IS NULL THEN
    RETURN public.ingest_norm_text(v);
  END IF;

  -- Trailing token is a state, or it is part of the place name.
  state := public.ingest_state_code(kept[array_length(kept, 1)]);
  IF state IS NOT NULL THEN
    kept := kept[1 : array_length(kept, 1) - 1];
  END IF;

  city := public.ingest_norm_text(array_to_string(kept, ' '));

  IF state IS NULL THEN
    RETURN city;
  ELSIF city = '' THEN
    RETURN state;
  ELSE
    RETURN city || '|' || state;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Rebuild the stored fingerprints
-- ---------------------------------------------------------------------------
-- Dropping the column drops postings_fingerprint_unique with it; both are
-- recreated below. The upsert's ON CONFLICT (fingerprint) target does not exist
-- between these statements, so this wants to run when no sweep is in flight.
ALTER TABLE public.postings DROP COLUMN fingerprint;

ALTER TABLE public.postings
  ADD COLUMN fingerprint text GENERATED ALWAYS AS (
    md5(
      public.ingest_norm_text(title)       || '|' ||
      public.ingest_norm_text(company)     || '|' ||
      public.ingest_norm_location(location)
    )
  ) STORED;

ALTER TABLE public.postings
  ADD CONSTRAINT postings_fingerprint_unique UNIQUE (fingerprint);

COMMENT ON FUNCTION public.ingest_norm_location(text) IS
  'Normalizes a free-text location for the fingerprint. Returns '''' for NULL, blank, and for count-shaped values such as "2 Locations" that name a quantity rather than a place (Workday locationsText). The raw string is still stored in postings.location.';

NOTIFY pgrst, 'reload schema';
