-- 20261026_ingest_norm_text_invisibles.sql
-- ingest_norm_text deletes zero-width and other invisible format characters
-- before normalizing.
--
-- WHAT CHANGES. Before this, an invisible character already became a space
-- (it is not [a-z0-9]), so "Ardagh​​ Group" was already "ardagh
-- group". The difference is an invisible INSIDE a word: "Point​72" used
-- to be "point 72" and is now "point72"; "Ana­lyst" (soft hyphen) used to
-- be "ana lyst" and is now "analyst". Google Jobs passes these through from
-- employer pages; Phase 1 on dev found one in "Ardagh​​ Group".
--
-- The TypeScript mirror (lib/ingest/fingerprint.ts normText) changes in the
-- same commit and must match exactly; tests/ingest/fingerprint-parity.ts
-- checks it against the database.
--
-- STORED VALUES ARE REBUILT. Both generated columns that read this function,
-- postings.fingerprint and employer_aliases.alias_norm, are dropped and
-- re-added so every stored value uses the new rule. If the new rule makes two
-- existing rows identical, re-adding the UNIQUE constraint fails and the whole
-- transaction rolls back, leaving everything as it was. Run the pre-check at
-- the bottom first; it must return 0 collisions.
--
-- Requires 20261025_ingest_serpapi_phase1.sql (employer_aliases).
-- Takes an ACCESS EXCLUSIVE lock on postings for the rebuild (seconds at
-- ~20k rows). On prod, run it outside the nightly ingest window.

BEGIN;

CREATE OR REPLACE FUNCTION public.ingest_norm_text(v text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        lower(
          regexp_replace(
            coalesce(v, ''),
            '[­͏؜᠎​-‏‪-‮⁠-⁯︀-️﻿]',
            '', 'g'
          )
        ),
        '[^a-z0-9]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  )
$$;

COMMENT ON FUNCTION public.ingest_norm_text(text) IS
  'Deletes invisible format characters (zero-width, soft hyphen, bidi marks, variation selectors, BOM), lowercases, turns non-alphanumerics into single spaces, trims. Changing it requires rebuilding postings.fingerprint and employer_aliases.alias_norm.';

-- postings.fingerprint
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

-- employer_aliases.alias_norm
ALTER TABLE public.employer_aliases DROP COLUMN alias_norm;

ALTER TABLE public.employer_aliases
  ADD COLUMN alias_norm text GENERATED ALWAYS AS (public.ingest_norm_text(alias)) STORED;

ALTER TABLE public.employer_aliases
  ADD CONSTRAINT employer_aliases_alias_norm_unique UNIQUE (alias_norm);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- PRE-CHECK: run this alone BEFORE the migration. Changes nothing (pg_temp
-- function, dropped at session end). Expect collisions = 0.
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION pg_temp.norm_new(v text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
--   SELECT btrim(regexp_replace(regexp_replace(lower(regexp_replace(coalesce(v, ''),
--     '[­͏؜᠎​-‏‪-‮⁠-⁯︀-️﻿]', '', 'g')),
--     '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'))
-- $f$;
-- WITH n AS (
--   SELECT id, fingerprint AS old_fp,
--          md5(pg_temp.norm_new(title) || '|' || pg_temp.norm_new(company) || '|' || public.ingest_norm_location(location)) AS new_fp
--   FROM public.postings
-- )
-- SELECT (SELECT count(*) FROM n WHERE old_fp <> new_fp) AS rows_changing,
--        (SELECT count(*) FROM (SELECT new_fp FROM n GROUP BY new_fp HAVING count(*) > 1) d) AS collisions,
--        (SELECT count(*) FROM (SELECT pg_temp.norm_new(alias) FROM public.employer_aliases GROUP BY 1 HAVING count(*) > 1) a) AS alias_collisions;

-- ---------------------------------------------------------------------------
-- VERIFY after: expect 'point72 analyst', and postings = distinct_fingerprints.
-- ---------------------------------------------------------------------------
-- SELECT public.ingest_norm_text(E'Point​72 Ana­lyst') AS should_be_point72_analyst,
--        (SELECT count(*) FROM public.postings) AS postings,
--        (SELECT count(DISTINCT fingerprint) FROM public.postings) AS distinct_fingerprints;
