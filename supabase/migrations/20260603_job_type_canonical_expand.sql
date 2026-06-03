-- Migration: job_type_canonical_expand (job_type overhaul — expanded normalize)
-- Created: 2026-06-03
-- Spec: docs/job-type-overhaul-spec.md §5 (extends 20260603_job_type_canonical.sql)
-- Scope: dev now (apply via Supabase SQL Editor — dev's schema_migrations tracker
--        is in the documented broken state, so `supabase db push --linked` isn't
--        reliable here).
-- PRODUCTION: REQUIRED before ANY job_type code promotes — see
--        project_pipeline_followups.md. Prod client_profiles.job_type has ~45
--        dirty rows in 9 variants; strict normalizeJobType would 400 them on save.
--
-- The Step-1 migration only mapped 'Full Time Role' and 'full time'. This expands
-- coverage to every observed legacy variant AND is robust to unseen case/spacing:
-- it matches on a compact key (lower + spaces/hyphens removed), mirroring
-- lib/jobType.ts canonicalizeLegacyJobType. Idempotent (each UPDATE skips
-- already-canonical rows), so re-running on dev — already normalized — is a safe
-- no-op. Covers BOTH client_profiles and coach_clients (both feed/read job_type);
-- coach_clients wasn't dumped but gets identical defensive normalization so both
-- columns are clean at promotion.

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['client_profiles','coach_clients'] LOOP
    -- "full time" family (any case/spacing/hyphenation) → Full-time
    EXECUTE format($f$
      UPDATE %I SET job_type = 'Full-time'
      WHERE job_type IS NOT NULL AND job_type <> 'Full-time'
        AND lower(regexp_replace(job_type, '[\s-]', '', 'g')) IN ('fulltime','fulltimerole')
    $f$, tbl);

    -- internship (any case) → Internship
    EXECUTE format($f$
      UPDATE %I SET job_type = 'Internship'
      WHERE job_type IS NOT NULL AND job_type <> 'Internship'
        AND lower(regexp_replace(job_type, '[\s-]', '', 'g')) = 'internship'
    $f$, tbl);

    -- part-time (any case/spacing) → Part-time (defensive; none observed)
    EXECUTE format($f$
      UPDATE %I SET job_type = 'Part-time'
      WHERE job_type IS NOT NULL AND job_type <> 'Part-time'
        AND lower(regexp_replace(job_type, '[\s-]', '', 'g')) = 'parttime'
    $f$, tbl);

    -- contract (any case) → Contract (defensive)
    EXECUTE format($f$
      UPDATE %I SET job_type = 'Contract'
      WHERE job_type IS NOT NULL AND job_type <> 'Contract'
        AND lower(regexp_replace(job_type, '[\s-]', '', 'g')) = 'contract'
    $f$, tbl);

    -- 'All' / 'any' (any case) → Any
    EXECUTE format($f$
      UPDATE %I SET job_type = 'Any'
      WHERE job_type IS NOT NULL AND job_type <> 'Any'
        AND lower(regexp_replace(job_type, '[\s-]', '', 'g')) IN ('all','any')
    $f$, tbl);

    -- Non-job-type values mis-filed into job_type → NULL
    EXECUTE format($f$
      UPDATE %I SET job_type = NULL
      WHERE job_type IS NOT NULL
        AND lower(regexp_replace(job_type, '[\s-]', '', 'g')) IN ('recentgraduate','currentstudent')
    $f$, tbl);
  END LOOP;
END $$;

-- Rollback: data normalization is not cleanly reversible (original spellings are
-- not recoverable row-by-row). No rollback provided by design. Do NOT re-add a
-- job_type CHECK — validation lives in the app layer (lib/jobType.ts).
