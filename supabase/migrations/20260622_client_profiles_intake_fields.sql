-- Migration: client_profiles_intake_fields
-- Created: 2026-06-22
-- Scope: dev (applied via Supabase SQL Editor per Foundation Risk 6 — dev's
--        schema_migrations tracker is in the documented broken state, so
--        `supabase db push --linked` isn't reliable here). This file is the
--        durable record of SQL already run on dev.
-- Production promotion: deferred (separate explicit approval step).
--
-- Additive only: 5 nullable client-detail columns on client_profiles, captured
-- by the coach Create Client flow. Mirrors the prospect-capture field set that
-- already exists on coach_clients, but these live on client_profiles — the
-- canonical record for an active client. No backfill (existing rows = NULL).
-- education_status reuses the coach_clients CHECK vocabulary.

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS education_status text
    CHECK (education_status IS NULL OR education_status IN
      ('in_school','graduated','na')),
  ADD COLUMN IF NOT EXISTS university text,
  ADD COLUMN IF NOT EXISTS grad_date date;

-- Rollback:
--   ALTER TABLE client_profiles
--     DROP COLUMN IF EXISTS phone,
--     DROP COLUMN IF EXISTS linkedin_url,
--     DROP COLUMN IF EXISTS education_status,
--     DROP COLUMN IF EXISTS university,
--     DROP COLUMN IF EXISTS grad_date;
