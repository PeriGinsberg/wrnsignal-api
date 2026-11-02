-- 20261120_posting_links_v2.sql
-- Job Queue (4 of 4): linker v2's tiers. REPORT ONLY.
--
-- Linker v2 (lib/ingest/linkV2.ts) joins copies of one job that today's linker
-- cannot: rows from the same source (Google Jobs returns one job through
-- several sites), employer and title spelt differently ("JPMorganChase",
-- "U.S."/"US", a "- Miami, Florida, US" suffix), and a vague location (a state,
-- "United States", "Anywhere") against the job's one city. Measured on prod
-- 2026-11-02: 161 groups, 169 extra rows of 16,144, every sampled group the
-- same job.
--
-- Its tiers:
--   same_location  same normalized location
--   no_city        a vague row joined to the job's single place (same state
--                  when it names one)
--
-- v2 runs after v1 on every linker run and logs its own posting_link_runs row
-- (rule_version 'v2-...', mode 'report'). It never writes posting_links; the
-- switch to write mode is a later, separate change. This migration only lets
-- posting_links hold the new tiers when that day comes, and records the
-- report's group detail.
--
-- Requires 20261027_posting_links.sql. Same file for dev and prod. Additive;
-- safe to run twice.

BEGIN;

ALTER TABLE public.posting_links DROP CONSTRAINT IF EXISTS posting_links_tier_valid;
ALTER TABLE public.posting_links ADD CONSTRAINT posting_links_tier_valid
  CHECK (tier IN ('city', 'count_location', 'same_location', 'no_city'));

-- v2's report: one entry per group, every member with its source, link kind
-- and the reasons the fingerprints differ.
ALTER TABLE public.posting_link_runs
  ADD COLUMN IF NOT EXISTS groups jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.posting_link_runs.groups IS
  'Linker v2 (report): each group of copies of one job, primary first, with the reasons their fingerprints differ.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify (every row true):
-- SELECT 'tiers' AS check, pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'posting_links_tier_valid')) LIKE '%no_city%' AS ok
-- UNION ALL SELECT 'groups column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posting_link_runs' AND column_name = 'groups')
-- UNION ALL SELECT 'still no links written', (SELECT count(*) FROM public.posting_links) = 0;
-- After the next nightly run (v2 rows appear):
-- SELECT started_at, rule_version, mode, postings_scanned, proposed_count, tier_counts, written_count
-- FROM public.posting_link_runs WHERE rule_version LIKE 'v2-%' ORDER BY started_at DESC LIMIT 3;
