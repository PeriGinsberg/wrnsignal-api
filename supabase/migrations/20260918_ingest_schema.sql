-- 20260918_ingest_schema.sql
-- Phase 1 step 1: the ingest schema. Schema only, no adapters.
--
-- WHY A NEW TABLE RATHER THAN lane_results. lane_results is per-lane and
-- per-client: the same posting found by four clients is four rows, and the
-- table carries a client's triage (action, reason, note) alongside the job.
-- Ingest is the opposite shape. One posting is ONE row regardless of who wants
-- it, and nothing in it belongs to a client. Mixing the two would mean every
-- ingested posting arrives pre-attached to somebody.
--
-- WHAT lane_results TAUGHT US, and what is corrected here:
--   * Its whole history was written between 2026-08-18 and 2026-09-01 and then
--     stopped dead. Nothing recorded WHY a run found nothing, so a blocked
--     scraper and an empty market looked identical. ingest_runs exists for
--     that, and control_passed is the column that tells them apart.
--   * Employer identity by name does not hold. 1,410 distinct company strings
--     covered far fewer real employers: JPMorgan Chase, JPMorganChase, Chase
--     and JPMC Candidate Experience page are one board. See the fingerprint
--     note below for what this schema does and does NOT claim to solve.
--   * source alone is not an employer key. It names the ATS vendor, and one
--     employer legitimately appears under several (Goldman Sachs posts under
--     both adhoc and oraclecloud). org_slug is what actually identifies a
--     board, so it is stored beside source rather than folded into it.

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
-- Feature-local, following the precedent set by search_lanes_set_updated_at
-- rather than depending on a shared public.set_updated_at that is not
-- verifiable from here.
CREATE OR REPLACE FUNCTION public.ingest_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Fingerprint normalization
-- ---------------------------------------------------------------------------
-- These three functions are the ONLY definition of what "the same posting"
-- means. They are IMMUTABLE because postings.fingerprint is a generated column
-- and Postgres will not accept anything else there.
--
-- THE COST OF THAT, stated up front: editing any of these functions does NOT
-- recompute fingerprints already stored. A change to normalization is a data
-- migration, not a function change, and the rebuild is:
--
--   ALTER TABLE public.postings DROP COLUMN fingerprint;
--   ALTER TABLE public.postings ADD COLUMN fingerprint text
--     GENERATED ALWAYS AS (...new expression...) STORED;
--   ALTER TABLE public.postings
--     ADD CONSTRAINT postings_fingerprint_unique UNIQUE (fingerprint);
--
-- which can fail on the unique constraint if the new rule merges rows that the
-- old one kept apart. That is a real migration with a dedup step in front of
-- it, and it is the reason to get this right before there is data.

-- Lowercase, strip punctuation to spaces, collapse whitespace, trim.
-- "Macy's, Inc." -> "macy s inc";  "Sr. Analyst  (Remote)" -> "sr analyst remote"
CREATE OR REPLACE FUNCTION public.ingest_norm_text(v text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(lower(coalesce(v, '')), '[^a-z0-9]+', ' ', 'g'),
      '\s+', ' ', 'g'
    )
  )
$$;

-- A US state name or postal code, reduced to the two-letter code. NULL when the
-- input is not a state, which is how the caller tells "this trailing token is a
-- state" from "this trailing token is part of the place name".
--
-- Inlined as a CASE rather than a lookup table because an IMMUTABLE function
-- may not read tables, and the generated column requires IMMUTABLE.
CREATE OR REPLACE FUNCTION public.ingest_state_code(v text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE btrim(lower(coalesce(v, '')))
    WHEN 'alabama' THEN 'al'        WHEN 'al' THEN 'al'
    WHEN 'alaska' THEN 'ak'         WHEN 'ak' THEN 'ak'
    WHEN 'arizona' THEN 'az'        WHEN 'az' THEN 'az'
    WHEN 'arkansas' THEN 'ar'       WHEN 'ar' THEN 'ar'
    WHEN 'california' THEN 'ca'     WHEN 'ca' THEN 'ca'
    WHEN 'colorado' THEN 'co'       WHEN 'co' THEN 'co'
    WHEN 'connecticut' THEN 'ct'    WHEN 'ct' THEN 'ct'
    WHEN 'delaware' THEN 'de'       WHEN 'de' THEN 'de'
    WHEN 'florida' THEN 'fl'        WHEN 'fl' THEN 'fl'
    WHEN 'georgia' THEN 'ga'        WHEN 'ga' THEN 'ga'
    WHEN 'hawaii' THEN 'hi'         WHEN 'hi' THEN 'hi'
    WHEN 'idaho' THEN 'id'          WHEN 'id' THEN 'id'
    WHEN 'illinois' THEN 'il'       WHEN 'il' THEN 'il'
    WHEN 'indiana' THEN 'in'        WHEN 'in' THEN 'in'
    WHEN 'iowa' THEN 'ia'           WHEN 'ia' THEN 'ia'
    WHEN 'kansas' THEN 'ks'         WHEN 'ks' THEN 'ks'
    WHEN 'kentucky' THEN 'ky'       WHEN 'ky' THEN 'ky'
    WHEN 'louisiana' THEN 'la'      WHEN 'la' THEN 'la'
    WHEN 'maine' THEN 'me'          WHEN 'me' THEN 'me'
    WHEN 'maryland' THEN 'md'       WHEN 'md' THEN 'md'
    WHEN 'massachusetts' THEN 'ma'  WHEN 'ma' THEN 'ma'
    WHEN 'michigan' THEN 'mi'       WHEN 'mi' THEN 'mi'
    WHEN 'minnesota' THEN 'mn'      WHEN 'mn' THEN 'mn'
    WHEN 'mississippi' THEN 'ms'    WHEN 'ms' THEN 'ms'
    WHEN 'missouri' THEN 'mo'       WHEN 'mo' THEN 'mo'
    WHEN 'montana' THEN 'mt'        WHEN 'mt' THEN 'mt'
    WHEN 'nebraska' THEN 'ne'       WHEN 'ne' THEN 'ne'
    WHEN 'nevada' THEN 'nv'         WHEN 'nv' THEN 'nv'
    WHEN 'new hampshire' THEN 'nh'  WHEN 'nh' THEN 'nh'
    WHEN 'new jersey' THEN 'nj'     WHEN 'nj' THEN 'nj'
    WHEN 'new mexico' THEN 'nm'     WHEN 'nm' THEN 'nm'
    WHEN 'new york' THEN 'ny'       WHEN 'ny' THEN 'ny'
    WHEN 'north carolina' THEN 'nc' WHEN 'nc' THEN 'nc'
    WHEN 'north dakota' THEN 'nd'   WHEN 'nd' THEN 'nd'
    WHEN 'ohio' THEN 'oh'           WHEN 'oh' THEN 'oh'
    WHEN 'oklahoma' THEN 'ok'       WHEN 'ok' THEN 'ok'
    WHEN 'oregon' THEN 'or'         WHEN 'or' THEN 'or'
    WHEN 'pennsylvania' THEN 'pa'   WHEN 'pa' THEN 'pa'
    WHEN 'rhode island' THEN 'ri'   WHEN 'ri' THEN 'ri'
    WHEN 'south carolina' THEN 'sc' WHEN 'sc' THEN 'sc'
    WHEN 'south dakota' THEN 'sd'   WHEN 'sd' THEN 'sd'
    WHEN 'tennessee' THEN 'tn'      WHEN 'tn' THEN 'tn'
    WHEN 'texas' THEN 'tx'          WHEN 'tx' THEN 'tx'
    WHEN 'utah' THEN 'ut'           WHEN 'ut' THEN 'ut'
    WHEN 'vermont' THEN 'vt'        WHEN 'vt' THEN 'vt'
    WHEN 'virginia' THEN 'va'       WHEN 'va' THEN 'va'
    WHEN 'washington' THEN 'wa'     WHEN 'wa' THEN 'wa'
    WHEN 'west virginia' THEN 'wv'  WHEN 'wv' THEN 'wv'
    WHEN 'wisconsin' THEN 'wi'      WHEN 'wi' THEN 'wi'
    WHEN 'wyoming' THEN 'wy'        WHEN 'wy' THEN 'wy'
    WHEN 'district of columbia' THEN 'dc' WHEN 'dc' THEN 'dc'
    WHEN 'puerto rico' THEN 'pr'    WHEN 'pr' THEN 'pr'
    ELSE NULL
  END
$$;

-- Location reduced to one consistent form:
--   "New York, NY"                      -> "new york|ny"
--   "New York, New York, United States" -> "new york|ny"
--   "New York, NY, USA"                 -> "new york|ny"
--   "Brooklyn, NY (+2 others)"          -> "brooklyn|ny"
--   "Remote"                            -> "remote"
--   NULL                                -> ""
--
-- Two deliberate non-collapses:
--
--   * A BARE STATE stays a state. "New York" alone becomes "ny", not
--     "new york|ny", so it does NOT merge with the city. The input is
--     genuinely ambiguous (Google Jobs returns "New York" meaning the state)
--     and under-merging is the safe direction: two rows that should be one is
--     a visible duplicate, one row that should be two is a lost posting.
--
--   * A COUNTRY-ONLY location stays itself. "United States" becomes
--     "united states", not "", so a nationwide posting does not hash the same
--     as a posting with no location at all. Those are different facts.
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
-- 1. postings -- one row per posting, across every source
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WHERE IT CAME FROM.
  -- source is the ATS vendor slug, matching the vocabulary lane_results
  -- already uses (workday, grnhse, lever, ashby, smartrecruiters, oraclecloud,
  -- icims2, adp, ultipro, bamboohr, workable, adhoc, ...). Not constrained to
  -- a fixed list: the set grows whenever an adapter is added, and a CHECK here
  -- would have to be edited in lockstep with code that is not in this file.
  source text NOT NULL,

  -- The board identifier WITHIN that source, as it appears in the platform's
  -- own URL: the Workday tenant ("envista"), the Greenhouse/Lever/Ashby org
  -- ("lakefrontbiotherapeuticsinc"), the SmartRecruiters company id
  -- ("CityOfNewYork"), the Oracle siteNumber ("CX_1001"), the ADP cid.
  -- NULLABLE on purpose: 35 Greenhouse employers reach us as employer-hosted
  -- embeds carrying only ?gh_jid=, and 26 Workable postings carry an opaque
  -- per-job token. Those have no derivable org, and NULL says so rather than
  -- inventing one.
  org_slug text,

  -- Workday needs a tenant AND a site; the tenant alone does not address a
  -- board. Kept separate so org_slug stays "the thing in the URL that names
  -- the org" for every source instead of meaning something different for one.
  tenant_id text,

  -- The platform's own id for the posting, when it gives one. Every adapter
  -- tested returns a stable id (Greenhouse id, Lever/Ashby uuid,
  -- SmartRecruiters id, Workday externalPath, Oracle requisition number).
  -- NOT a uniqueness key here: the fingerprint below is the declared identity
  -- for this table. This column exists so a row can be re-fetched at source
  -- and so fingerprint collisions can be detected rather than assumed absent.
  source_job_id text,

  -- WHAT IT IS.
  title text NOT NULL,
  company text NOT NULL,
  location text,

  -- Everything else an adapter happens to return. Deliberately a blob: the
  -- eleven platforms surveyed return between 5 and 18 fields with almost no
  -- overlap beyond the four columns above, and promoting a union of them to
  -- real columns would produce a table that is mostly NULL. Fields earn a
  -- column by being queried, not by existing.
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,

  apply_url text,

  -- IDENTITY.
  -- Normalized title + company + location, hashed. Generated rather than
  -- supplied, so a caller cannot write a row whose fingerprint disagrees with
  -- its own columns, and so the normalization has exactly one definition.
  --
  -- The raw title, company and location columns above are stored EXACTLY as the
  -- source gave them. Normalization happens only in here. That way a posting
  -- still displays as "Macy's, Inc." and "New York, New York, United States"
  -- while matching on "macy s inc" and "new york|ny", and a future change to
  -- the matching rule does not damage what was actually observed.
  --
  -- WHAT THIS CATCHES: the same posting re-crawled, the same posting reached
  -- through two sources, and the same posting whose location is spelled
  -- differently by different platforms. "New York, NY" and "New York, New York,
  -- United States" hash identically.
  --
  -- WHAT IT DOES NOT CATCH, stated plainly because the previous table's data
  -- proves it matters: corporate identity. "Macy's" and "Macy's, Inc." remain
  -- two employers here, as do JPMorgan Chase / JPMorganChase / Chase / JPMC
  -- Candidate Experience page, which lane_results carried as four employers on
  -- one board. Collapsing those needs an employer table with real resolution,
  -- which is not this step. The fingerprint is a de-duplicator, not a resolver,
  -- and nothing downstream should read it as one.
  fingerprint text GENERATED ALWAYS AS (
    md5(
      public.ingest_norm_text(title)       || '|' ||
      public.ingest_norm_text(company)     || '|' ||
      public.ingest_norm_location(location)
    )
  ) STORED,

  -- WHEN.
  -- posted_at is the EMPLOYER's date, which is not ours to set and is often
  -- absent or useless (Workday's list endpoint returns the string "Posted
  -- Today"). NULL means the source did not say, which is not the same as old.
  posted_at timestamptz,

  -- first_seen_at is set once and never touched again. last_seen_at advances
  -- every time ingest re-finds the posting. The pair is what distinguishes a
  -- posting that has fallen off its board (last_seen_at going stale) from one
  -- that was never found, and a single updated_at cannot express that.
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- The declared identity of the table, and the ON CONFLICT target for ingest.
  CONSTRAINT postings_fingerprint_unique UNIQUE (fingerprint),

  -- A posting with a blank title or company is not a posting. These arrive from
  -- eleven different parsers and an empty string is the shape a broken one
  -- produces, so it is rejected at write rather than found later in a report.
  CONSTRAINT postings_title_not_blank   CHECK (btrim(title) <> ''),
  CONSTRAINT postings_company_not_blank CHECK (btrim(company) <> ''),

  -- last_seen_at is advanced by ingest and first_seen_at never is, so the
  -- ordering is an invariant, not a preference. A violation means the upsert
  -- overwrote first_seen_at, which is the one bug this table cannot self-detect
  -- afterwards.
  CONSTRAINT postings_seen_order CHECK (last_seen_at >= first_seen_at)
);

-- Re-finding a posting at source is a lookup on (source, source_job_id), so it
-- gets an index. Partial: the column is NULL for every employer-hosted embed
-- and nothing ever searches for those by id.
CREATE INDEX IF NOT EXISTS idx_postings_source_job
  ON public.postings (source, source_job_id) WHERE source_job_id IS NOT NULL;

-- "What has this board got, and what has gone stale on it" is the per-board
-- question ingest asks every run.
CREATE INDEX IF NOT EXISTS idx_postings_board_last_seen
  ON public.postings (source, org_slug, last_seen_at DESC);

-- Freshness sweeps across all sources.
CREATE INDEX IF NOT EXISTS idx_postings_last_seen
  ON public.postings (last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_postings_company
  ON public.postings (company);

DROP TRIGGER IF EXISTS postings_set_updated_at ON public.postings;
CREATE TRIGGER postings_set_updated_at
  BEFORE UPDATE ON public.postings
  FOR EACH ROW EXECUTE FUNCTION public.ingest_set_updated_at();

COMMENT ON TABLE public.postings IS
  'One row per posting across all sources, deduped on a generated fingerprint of normalized title + company + location. first_seen_at is set once; last_seen_at advances on every re-find.';

-- ---------------------------------------------------------------------------
-- 2. ingest_pairs -- the global title + location list
-- ---------------------------------------------------------------------------
-- GLOBAL, not per client. This is the difference between ingest and
-- search_lanes and it is the point of the phase: lanes ask "what does THIS
-- client want", which means the same query runs once per client and the board
-- is hit N times for one answer. A pair is asked once, and every client reads
-- the result. Nothing here references client_profiles, and nothing should.
CREATE TABLE IF NOT EXISTS public.ingest_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Sent to each source's keyword parameter. The parameter NAME differs per
  -- platform (searchText, keyword, keywords, q) and that mapping belongs to the
  -- adapter, not here.
  title text NOT NULL,

  -- Free-text place name. NULL means no geographic filter, which is a real and
  -- distinct intent from "somewhere", so it is expressible.
  --
  -- Two of the four platforms tested take a plain city string; Workday needs
  -- facet GUIDs and Oracle needs numeric facet ids or lat/long. Translating
  -- this string into whatever a platform wants is the adapter's job. Storing a
  -- pre-translated id here would make the row mean something different per
  -- source and would not survive a platform changing its ids.
  location text,

  -- Pairs are paused, not deleted, so a pair's ingest_runs history survives
  -- being switched off.
  active boolean NOT NULL DEFAULT true,

  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ingest_pairs_title_not_blank CHECK (btrim(title) <> ''),

  -- An empty-string location would be a third spelling of "no location"
  -- alongside NULL, and the unique index below would treat it as a distinct
  -- pair. One spelling only.
  CONSTRAINT ingest_pairs_location_not_blank CHECK (location IS NULL OR btrim(location) <> '')
);

-- The pair IS the key, so it is unique. Two indexes because NULL locations do
-- not compare equal in a plain UNIQUE constraint, which would let
-- ("analyst", NULL) be inserted repeatedly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_pairs_unique
  ON public.ingest_pairs (lower(btrim(title)), lower(btrim(location)))
  WHERE location IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_pairs_unique_nulloc
  ON public.ingest_pairs (lower(btrim(title)))
  WHERE location IS NULL;

CREATE INDEX IF NOT EXISTS idx_ingest_pairs_active
  ON public.ingest_pairs (active) WHERE active;

DROP TRIGGER IF EXISTS ingest_pairs_set_updated_at ON public.ingest_pairs;
CREATE TRIGGER ingest_pairs_set_updated_at
  BEFORE UPDATE ON public.ingest_pairs
  FOR EACH ROW EXECUTE FUNCTION public.ingest_set_updated_at();

COMMENT ON TABLE public.ingest_pairs IS
  'Global title + location pairs that ingest runs. Not client-scoped: one pair serves every client. location NULL means no geographic filter.';

-- ---------------------------------------------------------------------------
-- 3. ingest_runs -- one row per (source, pair) attempt
-- ---------------------------------------------------------------------------
-- EVERY ATTEMPT WRITES A ROW, including the ones that found nothing. The
-- previous generation of this system went blind for seventeen days because a
-- lane that had stopped running and a lane that was finding nothing produced
-- the same evidence: no new rows. A run row is the only thing that separates
-- them.
CREATE TABLE IF NOT EXISTS public.ingest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  source text NOT NULL,

  -- The pair this run was for. ON DELETE SET NULL rather than CASCADE: the
  -- history of what ingest did is not the pair's property, and deleting a pair
  -- must not rewrite the record of runs that already happened.
  pair_id uuid REFERENCES public.ingest_pairs(id) ON DELETE SET NULL,

  -- The pair AS SENT, copied rather than joined. A pair can be edited or
  -- deleted, and a run row that follows the edit would misreport what was
  -- actually asked. This is the query that was issued.
  pair_title text,
  pair_location text,

  status text NOT NULL DEFAULT 'ok',

  -- HTTP requests this run made, pagination included. The cost side of the
  -- ledger: found_count alone cannot say whether 40 results took one request
  -- or forty.
  requests_made integer NOT NULL DEFAULT 0,

  -- Postings the source returned, before dedup.
  found_count integer NOT NULL DEFAULT 0,

  -- Rows that were new to postings. added_count < found_count is the normal,
  -- healthy state once ingest has been running; added_count = found_count on a
  -- mature board means the fingerprint is not matching and should be looked at.
  added_count integer NOT NULL DEFAULT 0,

  -- THE CONTROL. Half the platforms tested accept an unknown or unhandled
  -- filter parameter, return HTTP 200, and hand back the UNFILTERED board.
  -- Oracle echoed back Location: "New York" while ignoring it; the Jibe API
  -- ignored `keyword` and only honoured `keywords`. Both failures are silent
  -- and both look exactly like a successful narrow search.
  --
  -- So a run also issues its filter with a nonsense term and asserts the result
  -- collapses. TRUE means that assertion held and the filter provably bit.
  -- FALSE means the numbers in this row describe an unfiltered board and must
  -- not be read as a result for this pair. NULL means the control was not run.
  --
  -- Nullable, three-valued, on purpose: "we checked and it failed" and "we
  -- never checked" are different facts and a boolean NOT NULL would merge them.
  control_passed boolean,

  -- What the control actually did, when it is worth keeping: the term sent, the
  -- unfiltered total, the filtered total.
  control_detail jsonb,

  -- Free-form per-adapter detail. Same reasoning as postings.raw.
  detail jsonb,

  error text,

  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ingest_runs_status_valid CHECK (status IN ('ok', 'error', 'skipped')),

  -- Counts are counts.
  CONSTRAINT ingest_runs_counts_non_negative CHECK (
    requests_made >= 0 AND found_count >= 0 AND added_count >= 0
  ),

  -- A row cannot have added more than it found. This is the shape an
  -- off-by-one in the upsert accounting produces, and it is cheaper to reject
  -- than to find later in a chart.
  CONSTRAINT ingest_runs_added_within_found CHECK (added_count <= found_count),

  -- An error row must say what the error was, and an ok row must not carry one.
  -- The alternative is a status column nobody trusts.
  CONSTRAINT ingest_runs_error_shape CHECK (
    (status = 'error' AND error IS NOT NULL) OR (status <> 'error' AND error IS NULL)
  )
);

-- "What happened on this pair lately", the review query.
CREATE INDEX IF NOT EXISTS idx_ingest_runs_pair_created
  ON public.ingest_runs (pair_id, created_at DESC);

-- "Is this source working at all", the health query.
CREATE INDEX IF NOT EXISTS idx_ingest_runs_source_created
  ON public.ingest_runs (source, created_at DESC);

-- The alerting query: runs whose numbers cannot be trusted. Partial, because
-- a healthy system makes this the rare row and nothing scans the passing ones.
CREATE INDEX IF NOT EXISTS idx_ingest_runs_control_failed
  ON public.ingest_runs (created_at DESC) WHERE control_passed IS NOT TRUE;

COMMENT ON TABLE public.ingest_runs IS
  'One row per (source, pair) ingest attempt, written whether it succeeded or not. control_passed records whether the server-side filter was proven to bite; FALSE or NULL means found_count/added_count describe an unfiltered board.';

COMMENT ON COLUMN public.ingest_runs.control_passed IS
  'TRUE = a nonsense-term control query collapsed as expected, so the filter provably applied. FALSE = the control did not collapse, so this row''s counts are an unfiltered board. NULL = no control was run.';

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
-- All three tables are global infrastructure with no owning client, so there is
-- no ownership predicate to write. RLS is ENABLED WITH NO POLICY, which denies
-- every non-service-role caller outright. That is the intended access: ingest
-- runs service-role, and client-facing reads go through a matching layer that
-- does not exist yet rather than through direct table access.
--
-- Stated rather than left implicit because an empty policy list reads like an
-- oversight, and the next person to look will otherwise "fix" it.
ALTER TABLE public.postings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_runs  ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
