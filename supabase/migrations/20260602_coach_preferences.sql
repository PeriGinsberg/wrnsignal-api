-- Migration: coach_preferences
-- Created: 2026-06-02
-- Spec: docs/Features/prospect-configurable-pipeline-spec.md §0.4
-- Scope: dev (apply via Supabase SQL Editor per Foundation Risk 6 — dev's
--        schema_migrations tracker is in the documented broken state, so
--        `supabase db push --linked` isn't reliable here)
-- Production promotion: deferred (separate explicit approval step)
--
-- General-purpose per-coach key/value preference store, created now so the next
-- simple coach preference has a home without new schema work. The configurable
-- pipeline (a relational, ordered config) uses dedicated tables instead — this
-- table is for simple scalar/object preferences only (§0.4). Coach-owned;
-- managed server-side via the service-role client.

CREATE TABLE IF NOT EXISTS coach_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owning coach. Cascade-deletes the coach's preferences if the profile is
  -- removed. Mirrors the coach_clients / coach_calendar_connections FK pattern.
  coach_profile_id UUID NOT NULL
    REFERENCES client_profiles(id) ON DELETE CASCADE,

  key TEXT NOT NULL,
  value JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One row per (coach, key). Upserts target this constraint.
  UNIQUE (coach_profile_id, key)
);

-- Lookup by coach (the common read: load all of a coach's preferences).
CREATE INDEX IF NOT EXISTS idx_coach_preferences_coach_profile_id
  ON coach_preferences (coach_profile_id);

-- updated_at trigger uses the existing public.set_updated_at() function
-- (DD-07 convention — same function used by coach_clients, coach_client_notes,
-- coach_calendar_connections, etc.).
CREATE TRIGGER trg_coach_preferences_set_updated_at
  BEFORE UPDATE ON coach_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
