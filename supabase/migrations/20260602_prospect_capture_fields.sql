-- Migration: prospect_capture_fields (Prospects v0.2 capture)
-- Created: 2026-06-02
-- Spec: Prospects v0.2 capture (field set locked this session; spec lives in
--       the PM repo). Capture-only — conversion carry-over is a later step.
-- Scope: dev (apply via Supabase SQL Editor per Foundation Risk 6 — dev's
--        schema_migrations tracker is in the documented broken state, so
--        `supabase db push --linked` isn't reliable here)
-- Production promotion: deferred (separate explicit approval step)
--
-- Additive only: 15 new nullable columns on coach_clients for richer prospect
-- capture. No backfill (existing prospect rows simply have NULLs). Two CHECK
-- enums: education_status and job_type. job_type matches the Framer client
-- intake vocabulary exactly ('Full Time Role' / 'Internship' / 'Both') so a
-- prospect's job_type carries over cleanly when it later becomes a client.
--
-- NOTE (latent debt, not addressed here): the codebase has three divergent
-- job_type vocabularies — Framer intake 'Full Time Role', the D2C account page
-- 'Full Time', and the coach profile editor 'Full-time'/'Part-time'/etc.
-- We match the intake set here; reconciliation is a separate follow-up.

ALTER TABLE coach_clients
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS current_title text,
  ADD COLUMN IF NOT EXISTS current_company text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS education_status text
    CHECK (education_status IS NULL OR education_status IN
      ('in_school','graduated','na')),
  ADD COLUMN IF NOT EXISTS university text,
  ADD COLUMN IF NOT EXISTS field_of_study text,
  ADD COLUMN IF NOT EXISTS grad_date date,
  ADD COLUMN IF NOT EXISTS years_experience_approx int,
  ADD COLUMN IF NOT EXISTS job_type text
    CHECK (job_type IS NULL OR job_type IN
      ('Full Time Role','Internship','Both')),
  ADD COLUMN IF NOT EXISTS target_roles text,
  ADD COLUMN IF NOT EXISTS target_locations text,
  ADD COLUMN IF NOT EXISTS preferred_locations text,
  ADD COLUMN IF NOT EXISTS timeline text,
  -- tags: free-text, comma-separated (mirrors the existing text target_roles /
  -- target_locations pattern rather than a text[] array).
  ADD COLUMN IF NOT EXISTS tags text;

-- Rollback:
--   ALTER TABLE coach_clients
--     DROP COLUMN IF EXISTS linkedin_url,
--     DROP COLUMN IF EXISTS current_title,
--     DROP COLUMN IF EXISTS current_company,
--     DROP COLUMN IF EXISTS location,
--     DROP COLUMN IF EXISTS education_status,
--     DROP COLUMN IF EXISTS university,
--     DROP COLUMN IF EXISTS field_of_study,
--     DROP COLUMN IF EXISTS grad_date,
--     DROP COLUMN IF EXISTS years_experience_approx,
--     DROP COLUMN IF EXISTS job_type,
--     DROP COLUMN IF EXISTS target_roles,
--     DROP COLUMN IF EXISTS target_locations,
--     DROP COLUMN IF EXISTS preferred_locations,
--     DROP COLUMN IF EXISTS timeline,
--     DROP COLUMN IF EXISTS tags;
