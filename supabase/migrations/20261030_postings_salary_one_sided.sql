-- 20261030_postings_salary_one_sided.sql
-- A one-sided salary is stored as one-sided.
--
-- 20261029 required salary_low AND salary_high together, which forced the
-- writer to copy the stated end into the missing one: "from $90,000" became
-- exactly $90,000 and "up to $120,000" became exactly $120,000. Both invent a
-- figure the posting never gave. Now either end may be NULL on its own:
--
--   "$90,000"            low 90000, high 90000
--   "from $90,000"       low 90000, high NULL
--   "up to $120,000"     low NULL,  high 120000
--   no pay stated        both NULL and 'salary' in enrichment_not_stated
--
-- 20261029_postings_enrichment_v2.sql is updated to match, so a database built
-- from scratch gets these constraints in one step; this file moves one that
-- already has 20261029 (dev). Requires 20261029. Idempotent.

BEGIN;

ALTER TABLE public.postings
  DROP CONSTRAINT IF EXISTS postings_salary_shape,
  DROP CONSTRAINT IF EXISTS postings_not_stated_excludes_value;

ALTER TABLE public.postings
  ADD CONSTRAINT postings_salary_shape CHECK (
    (salary_low IS NULL AND salary_high IS NULL AND salary_period IS NULL)
    OR (
      (salary_low IS NOT NULL OR salary_high IS NOT NULL)
      AND (salary_low IS NULL OR salary_low >= 0)
      AND (salary_high IS NULL OR salary_high >= 0)
      AND (salary_low IS NULL OR salary_high IS NULL OR salary_high >= salary_low)
      AND (salary_period IS NULL OR salary_period IN ('year', 'month', 'week', 'day', 'hour'))
    )
  ),
  ADD CONSTRAINT postings_not_stated_excludes_value CHECK (
    (NOT ('years' = ANY (enrichment_not_stated)) OR (years_min IS NULL AND years_max IS NULL))
    AND (NOT ('salary' = ANY (enrichment_not_stated)) OR (salary_low IS NULL AND salary_high IS NULL))
    AND (NOT ('salary_currency' = ANY (enrichment_not_stated)) OR salary_currency IS NULL)
    AND (NOT ('graduation' = ANY (enrichment_not_stated)) OR graduation_text IS NULL)
    AND (NOT ('application_deadline' = ANY (enrichment_not_stated)) OR deadline_text IS NULL)
    AND (NOT ('requirements_summary' = ANY (enrichment_not_stated)) OR requirements_summary IS NULL)
    AND (NOT ('tools' = ANY (enrichment_not_stated)) OR tools IS NULL)
    AND (NOT ('level' = ANY (enrichment_not_stated)) OR level IS NULL)
    AND (NOT ('function' = ANY (enrichment_not_stated)) OR "function" IS NULL)
    AND (NOT ('industry' = ANY (enrichment_not_stated)) OR industry IS NULL)
  );

COMMENT ON COLUMN public.postings.salary_low IS
  'Lower end of the stated base pay, as stated (see salary_period). NULL beside salary_high is "up to"; never copied from salary_high.';
COMMENT ON COLUMN public.postings.salary_high IS
  'Upper end of the stated base pay. NULL beside salary_low is "from"; equal to salary_low for a single exact figure.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Verify (one row, both true)
-- ---------------------------------------------------------------------------
-- SELECT
--   pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.postings'::regclass AND conname = 'postings_salary_shape'))
--     LIKE '%salary_low IS NULL) OR (salary_high IS NULL)%' AS salary_one_sided_allowed,
--   pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.postings'::regclass AND conname = 'postings_not_stated_excludes_value'))
--     LIKE '%salary_low IS NULL) AND (salary_high IS NULL)%' AS not_stated_covers_both_ends;
