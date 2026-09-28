-- 20260919_postings_function_trading.sql
-- Adds "Trading" to the function vocabulary.
--
-- WHY A SECOND FILE rather than an edit to 20260919_postings_enrichment.sql:
-- that migration is already applied to dev, so editing its CHECK list changes
-- nothing on a database that has already run it. The list there is updated too,
-- so a database built from scratch gets the right constraint in one step; this
-- file is what moves one that is already live. Applying both in order is
-- idempotent, because this drops and recreates the constraint outright.
--
-- WHAT PROMPTED IT. Four near-identical Jane Street commodities roles landed on
-- three different values:
--
--   Power Analyst/Trader                    -> Finance and Accounting
--   Oil and Refined Products Analyst/Trader -> Data and Analytics
--   Grains and Oilseeds Analyst             -> Data and Analytics
--   Fundamental Research Analyst            -> Research and Development
--
-- The set had no member for taking positions in markets, so each posting took a
-- different nearest neighbour. This is the same gap as Account Management, and
-- it is the quieter of the two failure modes a closed set has: a missing member
-- that the model can approximate produces a WRONG ANSWER, where one it cannot
-- approximate produces a parse error. The parse error announces itself. The
-- wrong answer only shows up if somebody reads the values side by side.
--
-- NOTE FOR THE NEXT ONE: every future addition to either vocabulary needs a
-- file like this as well as the edit to the list in the main migration, because
-- a CHECK cannot be extended in place. If these get frequent, the vocabularies
-- want to become a lookup table with a foreign key instead of a CHECK.

ALTER TABLE public.postings
  DROP CONSTRAINT IF EXISTS postings_function_known;

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
  );

NOTIFY pgrst, 'reload schema';
