-- ═══════════════════════════════════════════════════
-- SIGNAL Profile & Personas — pilot wiring (2026-05-07)
-- ═══════════════════════════════════════════════════
--
-- Adds:
--   - client_personas.archived_at — soft-archive support (NULL = active).
--   - client_profiles.coach_notes_{avoid|strengths|concerns} — first-class
--     columns for the three coaching notes captured at client creation.
--     They were previously only embedded inside profile_text and could
--     not be edited as discrete fields.
--
-- Backfill is handled by scripts/_backfill-personas.ts (data-only, runnable
-- after this migration is applied). It creates one is_default=true persona
-- per client_profiles row whose resume_text is non-empty.
--
-- Reversibility:
--   ALTER TABLE client_personas DROP COLUMN archived_at;
--   ALTER TABLE client_profiles DROP COLUMN coach_notes_avoid;
--   ALTER TABLE client_profiles DROP COLUMN coach_notes_strengths;
--   ALTER TABLE client_profiles DROP COLUMN coach_notes_concerns;
--   DROP INDEX client_personas_profile_active_idx;

ALTER TABLE client_personas
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS coach_notes_avoid     TEXT,
  ADD COLUMN IF NOT EXISTS coach_notes_strengths TEXT,
  ADD COLUMN IF NOT EXISTS coach_notes_concerns  TEXT;

-- Used by the coach-side persona list ("active first, default at top").
CREATE INDEX IF NOT EXISTS client_personas_profile_active_idx
  ON client_personas (profile_id, is_default DESC, created_at DESC)
  WHERE archived_at IS NULL;
