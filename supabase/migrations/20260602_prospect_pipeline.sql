-- Migration: prospect_pipeline (configurable prospect pipeline)
-- Created: 2026-06-02
-- Spec: docs/Features/prospect-configurable-pipeline-spec.md §5, §6
-- Scope: dev (apply via Supabase SQL Editor per Foundation Risk 6 — dev's
--        schema_migrations tracker is in the documented broken state, so
--        `supabase db push --linked` isn't reliable here)
-- Production promotion: deferred (separate explicit approval step)
--
-- Two new tables (per-coach pipeline definition + per-prospect progress) plus
-- two new coach_clients columns. Empty tables only — default stages are seeded
-- lazily on first GET /api/coach/pipeline (build step 3), NOT here. The v0.1
-- hardcoded phase_* columns on coach_clients are intentionally left in place
-- (read-nothing/write-nothing) until the new model is validated; a later
-- cleanup migration drops them.

-- ════════════════════════════════════════════════════════════════════════
-- SCHEMA (DDL)
-- ════════════════════════════════════════════════════════════════════════

-- 1. coach_pipeline_stages — a coach's configured pipeline (the definition).
CREATE TABLE IF NOT EXISTS coach_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owning coach. Cascade-deletes the coach's pipeline if the profile is
  -- removed. Mirrors coach_clients / coach_preferences FK pattern.
  coach_profile_id UUID NOT NULL
    REFERENCES client_profiles(id) ON DELETE CASCADE,

  stage_key TEXT NOT NULL,    -- stable key: master-list id OR a custom id
  label TEXT NOT NULL,        -- display name (master default or custom text)
  sort_order INTEGER NOT NULL,-- coach's ordering
  is_custom BOOLEAN NOT NULL DEFAULT false,
  is_terminal BOOLEAN NOT NULL DEFAULT false,  -- true only for Convert
  active BOOLEAN NOT NULL DEFAULT true,         -- deselected stages → false (kept for history)

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (coach_profile_id, stage_key)
);

CREATE INDEX IF NOT EXISTS idx_coach_pipeline_stages_coach_profile_id
  ON coach_pipeline_stages (coach_profile_id);

-- updated_at trigger uses the existing public.set_updated_at() function
-- (DD-07 convention).
CREATE TRIGGER trg_coach_pipeline_stages_set_updated_at
  BEFORE UPDATE ON coach_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. prospect_stage_progress — per-prospect progress through stages.
--    coach_client_id FK ON DELETE CASCADE so clearing/deleting a prospect
--    cleans up its progress rows automatically (no orphans).
CREATE TABLE IF NOT EXISTS prospect_stage_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  coach_client_id UUID NOT NULL
    REFERENCES coach_clients(id) ON DELETE CASCADE,

  stage_key TEXT NOT NULL,
  reached_at TIMESTAMPTZ,      -- when this stage was reached (the timestamp spine)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (coach_client_id, stage_key)
);

CREATE INDEX IF NOT EXISTS idx_prospect_stage_progress_coach_client_id
  ON prospect_stage_progress (coach_client_id);

-- 3. Two new columns on coach_clients. prospect_status is a sub-status WITHIN
--    the Prospect lifecycle (§5.3) — distinct from lifecycle_status, which is
--    NOT touched here. current_stage_key denormalizes the prospect's current
--    stage for list rendering without a join. Both nullable; existing rows
--    unaffected. The 7 hardcoded phase_* columns are NOT touched.
ALTER TABLE coach_clients
  ADD COLUMN IF NOT EXISTS prospect_status TEXT
    CHECK (prospect_status IS NULL OR prospect_status IN
      ('active','inactive','won','lost')),
  ADD COLUMN IF NOT EXISTS current_stage_key TEXT;

-- ════════════════════════════════════════════════════════════════════════
-- DEV-ONLY DATA CLEANUP  (NOT schema — do NOT carry to prod)
-- ════════════════════════════════════════════════════════════════════════
-- Spec §6 (UPDATE 2026-06-02): existing v0.1 prospect data is test-only; no
-- forward-map migration is performed. Clear the 5 test prospect rows captured
-- under the v0.1 model so the new model starts clean. IDs from Step-0 recon
-- (2026-06-02 dev): the only lifecycle_status='Prospect' rows.
--
-- coach_client_notes referencing these rows cascade-delete via the existing
-- coach_client_notes.coach_client_id FK (ON DELETE CASCADE). Any linked
-- client_profiles are intentionally LEFT in place (test data; out of scope —
-- deleting the coach_clients row does not touch the profile).
--
-- Guarded by lifecycle_status='Prospect' AND the explicit id list so this can
-- only ever remove the five known test rows, never a real future prospect.
DELETE FROM coach_clients
WHERE lifecycle_status = 'Prospect'
  AND id IN (
    '086d2a9d-624f-4efa-9bde-561a384733e1',  -- Josh Rosenblatt
    '6bd620c6-9b32-4eb6-81ed-bcad11d5d226',  -- (unnamed)
    '94571e6b-b219-4243-8382-17dd8aafcd23',  -- Test Customer 5
    '3a62567b-9d56-4463-be96-146aa6340a16',  -- test prospect
    '5e9e84fa-79bd-4233-8dc4-d61728cc0787'   -- Prospect A
  );
