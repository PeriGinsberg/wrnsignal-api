-- Migration: job_type_canonical (job_type overhaul — Step 1: drop CHECK + normalize)
-- Created: 2026-06-03
-- Spec: docs/job-type-overhaul-spec.md §4 (drop CHECK) + §5 (normalize data)
-- Scope: dev (apply via Supabase SQL Editor per Foundation Risk 6 — dev's
--        schema_migrations tracker is in the documented broken state, so
--        `supabase db push --linked` isn't reliable here)
-- Production promotion: deferred (separate explicit approval step)
--
-- Canonical job_type vocabulary system-wide: Full-time / Part-time /
-- Internship / Contract / Any. Multi-select (comma-joined) values are allowed,
-- so NO CHECK constraint is (re)added to either column — validation moves to the
-- app layer in a later step. This step only removes the blocking constraint and
-- normalizes existing data to the canonical spelling via explicit value matches
-- (auditable; no blanket lowercase/regex).

-- ════════════════════════════════════════════════════════════════════════
-- 1. Drop the coach_clients job_type CHECK (Prospects v0.2 enum).
--    It permitted only 'Full Time Role' / 'Internship' / 'Both' and would
--    reject both the canonical set and comma-joined multi values.
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE coach_clients
  DROP CONSTRAINT IF EXISTS coach_clients_job_type_check;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Normalize existing values to canonical, explicit value-match only.
--    Leaves 'Full-time', 'Internship', and NULL untouched (no row matches
--    those in the WHERE clauses below).
-- ════════════════════════════════════════════════════════════════════════

-- coach_clients: the v0.2 prospect vocab → canonical.
UPDATE coach_clients
  SET job_type = 'Full-time'
  WHERE job_type = 'Full Time Role';

-- client_profiles: legacy + intake/carry-over variants → canonical.
UPDATE client_profiles
  SET job_type = 'Full-time'
  WHERE job_type = 'Full Time Role';

UPDATE client_profiles
  SET job_type = 'Full-time'
  WHERE job_type = 'full time';

-- Rollback:
--   Data normalization is not cleanly reversible (the original distinct
--   spellings are not recoverable row-by-row). The dropped CHECK should NOT
--   be re-added — it would now reject the canonical values this migration
--   writes. No rollback provided by design.
