-- 20260525_prospect_phone.sql
--
-- Add optional phone column to coach_clients for prospect capture
-- (extends Prospects v0.1's coach_clients schema).
--
-- Apply: dev's schema_migrations table never seeded from pg_dump
-- (project_dev_migration_tracker_drift.md), so `supabase db push
-- --linked` fails on dev. Apply via Supabase SQL Editor instead.
-- Same workaround used on 2026-05-08 and again for the prospects
-- v0.1 migration.

ALTER TABLE coach_clients
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- Rollback:
--   ALTER TABLE coach_clients DROP COLUMN IF EXISTS phone;
