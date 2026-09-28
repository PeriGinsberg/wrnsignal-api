-- 20260919_postings_enrichment.sql
-- Phase 2: the extracted fields land on postings. Schema only; the enrichment
-- runner that fills them is a separate step.
--
-- ---------------------------------------------------------------------------
-- THE PROBLEM THIS FILE EXISTS TO SOLVE: THREE STATES, NOT TWO.
-- ---------------------------------------------------------------------------
-- Every extracted field has three possible states, and collapsing any two of
-- them destroys the one thing the extractor was built to preserve:
--
--   1. NOT YET ENRICHED  - no Claude call has been made for this posting.
--   2. NOT STATED        - a call was made; the posting says nothing.
--   3. A VALUE           - a call was made; the posting says this.
--
-- A plain nullable column has only two. Reading NULL as "not stated" would
-- silently promote every un-enriched row into a posting that "requires no
-- experience" and "names no salary", which is exactly the failure the
-- extractor's two-marker design (see lib/ingest/extractPosting.ts) was written
-- to prevent. It would also make backfill progress unmeasurable: you could
-- never count what was left to do.
--
-- HOW THE THIRD STATE IS STORED: enrichment_not_stated, an array naming the
-- fields the extractor explicitly returned not-stated for.
--
--   column NULL, name NOT in array  -> state 1, not yet enriched
--   column NULL, name IS  in array  -> state 2, extractor looked and found nothing
--   column NOT NULL                 -> state 3, a stated value
--
-- WHY AN ARRAY RATHER THAN THE OBVIOUS ALTERNATIVES.
--
--   * "Use enriched_at as the discriminator" (NULL column plus enriched_at set
--     means not-stated) reads well today and breaks the first time a field is
--     ADDED. Every row enriched before that day has enriched_at set and the new
--     column NULL, so the new field reads as "the posting states nothing" for
--     the entire back catalogue when the truth is "we never looked". That is a
--     silent corruption of the exact distinction this table is protecting, and
--     it is not detectable after the fact. The array cannot fail that way: an
--     old row does not name the new field, so it correctly reads as state 1.
--
--   * "Store the literal 'not_stated' in the column" works for function and
--     industry, because they are closed sets and no member can collide with the
--     marker. It cannot work for years_required, salary_min or salary_max,
--     which are integers, and it cannot safely work for requirements_summary or
--     level, which are open text where a genuine value could be the marker.
--     Two mechanisms on one table is worse than one that covers every field.
--
--   * A boolean companion per field is nine more columns saying what one array
--     says, and nothing keeps the nine in step with each other.
--
-- The array is constrained below so it can only name real fields, and so a
-- field can never be listed as not-stated while also holding a value.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT HERE
-- ---------------------------------------------------------------------------
-- No confidence score. The evidence quote is the confidence signal, and a
-- number would invite thresholding on a quantity the model is not calibrated to
-- produce.
--
-- No model or prompt version column. It belongs on a per-run table, the shape
-- ingest_runs already has, rather than smeared across every posting row, where
-- it would mean rewriting all of them on every prompt change. enriched_at is
-- enough to correlate a row with a run until that table exists.

-- ---------------------------------------------------------------------------
-- Columns. Nullable throughout.
-- ---------------------------------------------------------------------------
ALTER TABLE public.postings
  -- The scored field. Whole years. 0 and not-stated are different answers, and
  -- the array below is what keeps them different in storage, as the union type
  -- in YearsSchema keeps them different on the wire.
  ADD COLUMN IF NOT EXISTS years_required integer,

  -- Annualised BASE pay. Not OTE, not total compensation, not equity, not
  -- bonus. A posting stating a single figure rather than a range writes it to
  -- both columns, so a point salary can never be read as the floor of a range.
  ADD COLUMN IF NOT EXISTS salary_min integer,
  ADD COLUMN IF NOT EXISTS salary_max integer,
  ADD COLUMN IF NOT EXISTS salary_currency text,

  ADD COLUMN IF NOT EXISTS requirements_summary text,

  -- text[] rather than jsonb: a flat list of names with no structure to
  -- preserve, and text[] gets = ANY() and a GIN index without a cast.
  ADD COLUMN IF NOT EXISTS tools text[],

  ADD COLUMN IF NOT EXISTS level text,

  -- "function" is a NON-RESERVED keyword in Postgres, so it is legal as a
  -- column name and callers need not quote it. Quoted here only so the DDL
  -- reads unambiguously.
  ADD COLUMN IF NOT EXISTS "function" text,
  ADD COLUMN IF NOT EXISTS industry text,

  -- Evidence beside the two closed enums, per the rule that an enum value with
  -- no quote is a guess. A closed set makes a wrong answer look exactly like a
  -- right one; the quote is the only thing that tells them apart, and the CHECK
  -- below makes storing one without the other impossible rather than merely
  -- discouraged.
  ADD COLUMN IF NOT EXISTS function_evidence text,
  ADD COLUMN IF NOT EXISTS industry_evidence text,

  -- The third state. See the header.
  ADD COLUMN IF NOT EXISTS enrichment_not_stated text[] NOT NULL DEFAULT '{}'::text[],

  -- NULL means no extraction has ever run for this row. Set by the enrichment
  -- writer on every successful extraction, INCLUDING one that returns
  -- not-stated for every field: that is a completed observation, not a
  -- non-event.
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz,

  -- FAILURE IS A FOURTH STATE AND MUST NOT LOOK LIKE THE FIRST.
  --
  -- extractPosting retries a parse failure twice and then throws
  -- ExtractionFailed. If the caller merely skipped that posting, the row would
  -- be left exactly as an untouched row looks, and the next worklist query
  -- would pick it up again, fail again, and skip again - forever, silently,
  -- while "postings remaining" never moved. The run would look healthy and the
  -- backfill would never finish.
  --
  -- So a failure is RECORDED. enrichment_failed_at is when the last attempt
  -- gave up; enrichment_error is what it said.
  --
  --   enriched_at NULL, failed_at NULL      -> never attempted (the worklist)
  --   enriched_at NULL, failed_at NOT NULL  -> attempted, gave up
  --   enriched_at NOT NULL                  -> has data
  --
  -- The third and second are not exclusive: a row enriched last week whose
  -- re-extraction failed today has both, meaning "the stored fields are real
  -- but stale and the last attempt to refresh them failed". Collapsing that
  -- into one column would force a choice between losing the data and losing the
  -- failure.
  --
  -- The writer clears failed_at and enrichment_error on a later success, so a
  -- recovered posting stops being reported as failed.
  ADD COLUMN IF NOT EXISTS enrichment_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS enrichment_error text;

-- ---------------------------------------------------------------------------
-- Vocabulary constraints
-- ---------------------------------------------------------------------------
-- These are the SAME sets as FUNCTIONS and INDUSTRIES in
-- lib/ingest/extractPosting.ts, duplicated here on purpose: the database must
-- reject a value the extractor was never allowed to produce, including one
-- written by hand or by a future caller that does not import the TypeScript.
--
-- The duplication is a real drift risk and nothing in this file defends against
-- it. It wants a test that reads both lists and asserts they are equal.
--
-- Deliberately no 'not_stated' member. Not-stated lives in
-- enrichment_not_stated, so there is exactly one way to say it.
ALTER TABLE public.postings
  ADD CONSTRAINT postings_function_known CHECK (
    "function" IS NULL OR "function" IN (
      'Marketing',
      'Finance and Accounting',
      'Trading',
      'Business Operations',
      'Project and Program Management',
      'Engineering',
      'Sales',
      'Account Management',
      'Data and Analytics',
      'Legal and Compliance',
      'Administrative and Clerical',
      'Research and Development',
      'Information Technology',
      'Customer Service',
      'Product Management',
      'Human Resources',
      'Design',
      'Consulting',
      'Supply Chain and Logistics',
      'Healthcare Services - Allied Health',
      'Healthcare Services - Nursing',
      'Healthcare Services - Advanced Practice',
      'Healthcare Services - Pharmacy',
      'Healthcare Services - Veterinary',
      'Skilled Trades',
      'Education'
    )
  ),
  ADD CONSTRAINT postings_industry_known CHECK (
    industry IS NULL OR industry IN (
      'Financial Services',
      'Banking',
      'Investment Banking & Capital Markets',
      'Investment & Asset Management',
      'Insurance',
      'Real Estate',
      'Construction',
      'Healthcare',
      'Pharmaceuticals & Biotech',
      'Software & Technology',
      'IT Services',
      'Management Consulting',
      'Professional Services',
      'Legal Services',
      'Marketing & Advertising',
      'Media & Publishing',
      'Entertainment',
      'Sports',
      'Social Media',
      'Retail & E-commerce',
      'Consumer Goods',
      'Beauty & Fashion',
      'Manufacturing',
      'Transportation & Logistics',
      'Energy & Utilities',
      'Higher Education',
      'Government & Public Sector'
    )
  );

-- ---------------------------------------------------------------------------
-- Evidence is not optional beside an enum value
-- ---------------------------------------------------------------------------
ALTER TABLE public.postings
  ADD CONSTRAINT postings_function_has_evidence CHECK (
    "function" IS NULL OR btrim(coalesce(function_evidence, '')) <> ''
  ),
  ADD CONSTRAINT postings_industry_has_evidence CHECK (
    industry IS NULL OR btrim(coalesce(industry_evidence, '')) <> ''
  ),
  -- A failure with no reason recorded is barely better than a silent skip: it
  -- says something went wrong and gives nobody a way to find out what. The two
  -- columns move together or not at all.
  ADD CONSTRAINT postings_failure_has_reason CHECK (
    (enrichment_failed_at IS NULL AND enrichment_error IS NULL)
    OR (enrichment_failed_at IS NOT NULL AND btrim(coalesce(enrichment_error, '')) <> '')
  );

-- ---------------------------------------------------------------------------
-- Value sanity
-- ---------------------------------------------------------------------------
ALTER TABLE public.postings
  ADD CONSTRAINT postings_years_non_negative CHECK (
    years_required IS NULL OR years_required >= 0
  ),
  ADD CONSTRAINT postings_salary_non_negative CHECK (
    (salary_min IS NULL OR salary_min >= 0)
    AND (salary_max IS NULL OR salary_max >= 0)
  ),
  -- Equality is allowed and is the documented encoding of a single stated
  -- figure. Only max < min is a contradiction.
  ADD CONSTRAINT postings_salary_order CHECK (
    salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min
  ),
  -- An empty array would be a fourth state meaning neither "none named" nor
  -- "not stated", which is the ambiguity tools was given a marker to avoid. A
  -- NULL or blank element is a broken parse, not a tool.
  ADD CONSTRAINT postings_tools_non_empty CHECK (
    tools IS NULL
    OR (
      array_length(tools, 1) >= 1
      AND array_position(tools, NULL) IS NULL
      AND NOT ('' = ANY (tools))
    )
  );

-- ---------------------------------------------------------------------------
-- The three-state invariant
-- ---------------------------------------------------------------------------
ALTER TABLE public.postings
  -- The array may name only fields that exist. Without this it silently becomes
  -- a free-text junk drawer and the state machine stops meaning anything.
  ADD CONSTRAINT postings_not_stated_fields_known CHECK (
    enrichment_not_stated <@ ARRAY[
      'years_required',
      'salary_min',
      'salary_max',
      'salary_currency',
      'requirements_summary',
      'tools',
      'level',
      'function',
      'industry'
    ]::text[]
  ),

  -- A field cannot both hold a value and be marked not-stated. This is what
  -- makes the encoding trustworthy: without it the two halves can disagree and
  -- every reader has to invent a rule for which one wins.
  ADD CONSTRAINT postings_not_stated_excludes_value CHECK (
    (NOT ('years_required'       = ANY (enrichment_not_stated)) OR years_required       IS NULL)
    AND (NOT ('salary_min'           = ANY (enrichment_not_stated)) OR salary_min           IS NULL)
    AND (NOT ('salary_max'           = ANY (enrichment_not_stated)) OR salary_max           IS NULL)
    AND (NOT ('salary_currency'      = ANY (enrichment_not_stated)) OR salary_currency      IS NULL)
    AND (NOT ('requirements_summary' = ANY (enrichment_not_stated)) OR requirements_summary IS NULL)
    AND (NOT ('tools'                = ANY (enrichment_not_stated)) OR tools                IS NULL)
    AND (NOT ('level'                = ANY (enrichment_not_stated)) OR level                IS NULL)
    AND (NOT ('function'             = ANY (enrichment_not_stated)) OR "function"           IS NULL)
    AND (NOT ('industry'             = ANY (enrichment_not_stated)) OR industry             IS NULL)
  ),

  -- Nothing enriched without a timestamp saying when. This is what keeps state
  -- 1 honest: a row with no enriched_at must be completely untouched by
  -- extraction, so "WHERE enriched_at IS NULL" is an exact worklist rather than
  -- an approximate one.
  ADD CONSTRAINT postings_enrichment_requires_timestamp CHECK (
    enriched_at IS NOT NULL
    OR (
      years_required IS NULL
      AND salary_min IS NULL
      AND salary_max IS NULL
      AND salary_currency IS NULL
      AND requirements_summary IS NULL
      AND tools IS NULL
      AND level IS NULL
      AND "function" IS NULL
      AND industry IS NULL
      AND function_evidence IS NULL
      AND industry_evidence IS NULL
      AND enrichment_not_stated = '{}'::text[]
    )
  );

-- ---------------------------------------------------------------------------
-- last_seen_at must not move when a row is enriched
-- ---------------------------------------------------------------------------
-- WHY THIS IS IN THIS MIGRATION AND NOT A LATER ONE: the columns above are
-- unusable without it.
--
-- postings_touch_last_seen currently advances last_seen_at to now() on EVERY
-- update, which was correct while ingest was the only writer. The enrichment
-- writer is an UPDATE too, so the first backfill would stamp every enriched row
-- as re-found on its board at that moment, without anyone having looked at a
-- board. That destroys the exact signal the pair was added for: last_seen_at
-- going stale is how a posting that has fallen off its board is detected, and a
-- backfill would reset that clock for all 909 rows at once, in one statement,
-- with no way to reconstruct the real values afterwards.
--
-- The discriminator is enriched_at. Ingest never writes it, so it is unchanged
-- on an ingest upsert and last_seen_at advances exactly as before. The
-- enrichment writer always sets it, so it differs and both timestamps are
-- pinned.
--
-- first_seen_at stays pinned UNCONDITIONALLY. The point of the original trigger
-- was that no caller can rewrite an observation, and an enrichment write must
-- not become the exception that quietly reopens it.
--
-- Narrow edge case, stated rather than hidden: two enrichment writes landing in
-- one transaction would leave enriched_at not distinct and take the ingest
-- branch. now() is transaction time, so separate transactions always differ;
-- the enrichment writer must not write a row twice in one transaction.
CREATE OR REPLACE FUNCTION public.postings_touch_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  -- Unconditional: first_seen_at is unwritable through UPDATE, by anyone.
  NEW.first_seen_at = OLD.first_seen_at;

  IF NEW.enriched_at IS NOT DISTINCT FROM OLD.enriched_at
     AND NEW.enrichment_failed_at IS NOT DISTINCT FROM OLD.enrichment_failed_at THEN
    -- Ingest touch: the posting was observed on a board just now.
    NEW.last_seen_at = now();
  ELSE
    -- Enrichment write, succeeded OR failed: re-reading a description already
    -- stored is not a new observation of the board, so the pair is left exactly
    -- as it was. The failure branch matters as much as the success branch - a
    -- run that fails on 200 postings must not refresh 200 last_seen_at values.
    NEW.last_seen_at = OLD.last_seen_at;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- The enrichment runner's hot query: what has never been attempted. Partial, so
-- it indexes the shrinking worklist rather than the whole table, and empties
-- itself as the backfill completes.
--
-- NOTE THE failed_at CLAUSE. Without it the worklist re-serves every posting
-- that has already failed three times, every run, forever, and the backfill
-- never terminates while appearing to work.
CREATE INDEX IF NOT EXISTS postings_unenriched_idx
  ON public.postings (first_seen_at)
  WHERE enriched_at IS NULL AND enrichment_failed_at IS NULL;

-- The second worklist, deliberately separate: retrying failures is an explicit
-- decision, not something that happens by default on the next nightly run. Also
-- the query behind "what is broken", which is the number that should be looked
-- at rather than inferred from a shortfall in the first list.
CREATE INDEX IF NOT EXISTS postings_enrichment_failed_idx
  ON public.postings (enrichment_failed_at)
  WHERE enrichment_failed_at IS NOT NULL;

-- No index on function, industry, years_required or salary yet, following this
-- schema's own rule that a field earns an index by being queried. Nothing reads
-- them until the matcher is built, and 909 rows do not need help.

-- ---------------------------------------------------------------------------
-- Documentation
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.postings.enrichment_not_stated IS
  'Field names the extractor explicitly returned not-stated for. Together with the value columns this encodes three states: column NULL and name absent = not yet enriched; column NULL and name present = the extractor read the posting and it states nothing; column non-NULL = a stated value. Never infer not-stated from a NULL column alone.';

COMMENT ON COLUMN public.postings.enriched_at IS
  'When extraction last completed successfully for this row. Set even when every field came back not-stated. Writing it suppresses the last_seen_at bump in postings_touch_last_seen. The never-attempted worklist is enriched_at IS NULL AND enrichment_failed_at IS NULL; enriched_at IS NULL alone also matches postings that failed.';

COMMENT ON COLUMN public.postings.enrichment_failed_at IS
  'When extraction last gave up on this row, after extractPosting exhausted its retries. Distinguishes a posting that was attempted and failed from one never attempted, so a permanently failing posting cannot sit in the worklist forever without being counted. Cleared by the writer on a later success.';

COMMENT ON COLUMN public.postings.enrichment_error IS
  'Why the last extraction attempt gave up. Required whenever enrichment_failed_at is set.';

COMMENT ON COLUMN public.postings.years_required IS
  'Minimum years of experience the posting states. 0 is a real requirement ("0-2 years", "no experience required") and is NOT the same as not-stated, which is recorded in enrichment_not_stated.';

COMMENT ON COLUMN public.postings.salary_min IS
  'Annualised BASE pay floor as stated. Never OTE, total compensation, equity or bonus. A single stated figure is written to both salary_min and salary_max.';

COMMENT ON COLUMN public.postings.salary_max IS
  'Annualised BASE pay ceiling as stated. Equal to salary_min when the posting states one figure rather than a range.';

COMMENT ON COLUMN public.postings.tools IS
  'Named software, platforms, languages and systems the posting asks for. Never empty: none named is recorded in enrichment_not_stated.';

COMMENT ON COLUMN public.postings."function" IS
  'Closed vocabulary, matching FUNCTIONS in lib/ingest/extractPosting.ts. Requires a non-blank function_evidence quote.';

COMMENT ON COLUMN public.postings.industry IS
  'The EMPLOYER''s stated industry, closed vocabulary matching INDUSTRIES in lib/ingest/extractPosting.ts. Stated means the posting says it; the company name alone does not. Requires a non-blank industry_evidence quote.';

COMMENT ON FUNCTION public.postings_touch_last_seen() IS
  'BEFORE UPDATE on postings: pins first_seen_at always, and advances last_seen_at to now() only when enriched_at is unchanged. An enrichment write always sets enriched_at, so it leaves both timestamps alone and backfilling extracted fields cannot masquerade as re-finding every posting on its board.';

NOTIFY pgrst, 'reload schema';
