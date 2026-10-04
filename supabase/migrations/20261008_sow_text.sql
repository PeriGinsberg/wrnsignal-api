-- SOW text in Settings. 2026-10-08.
--
-- IN PLAIN ENGLISH
--
-- 1. Each library deliverable can carry SOW bullets: client-facing lines, one
--    per line of text, shown under the deliverable on a client's SOW.
-- 2. Each phase can carry a subtitle (shown as the SOW stage heading, e.g.
--    "Know: Your SIGNAL DNA and Career Paths") and a closing note (shown under
--    that stage).
-- 3. coach_sow_lines: the practice's standard SOW sections (Included at no
--    charge, Optional addition, How we work, Not included). Each line shows on
--    every SOW, only when a phase is in the client's plan, or only when a phase
--    is NOT in the plan.
--
-- Additive: new nullable columns and a new table. Nothing reads them until the
-- code ships, so it is safe to run ahead of the promote. Safe to run twice.
--
-- Reversibility:
--   DROP TABLE IF EXISTS coach_sow_lines;
--   ALTER TABLE coach_phases DROP COLUMN IF EXISTS sow_subtitle, DROP COLUMN IF EXISTS sow_note;
--   ALTER TABLE coach_milestones DROP COLUMN IF EXISTS sow_bullets;

ALTER TABLE coach_milestones
  ADD COLUMN IF NOT EXISTS sow_bullets TEXT CHECK (sow_bullets IS NULL OR char_length(sow_bullets) <= 2000);

ALTER TABLE coach_phases
  ADD COLUMN IF NOT EXISTS sow_subtitle TEXT CHECK (sow_subtitle IS NULL OR char_length(sow_subtitle) <= 80),
  ADD COLUMN IF NOT EXISTS sow_note     TEXT CHECK (sow_note IS NULL OR char_length(sow_note) <= 1000);

CREATE TABLE IF NOT EXISTS coach_sow_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_profile_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  section          TEXT NOT NULL CHECK (section IN ('included', 'optional', 'how_we_work', 'not_included')),
  body             TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  -- every_plan: always. phase_in_plan / phase_not_in_plan: tied to phase_id.
  show_for         TEXT NOT NULL DEFAULT 'every_plan'
                   CHECK (show_for IN ('every_plan', 'phase_in_plan', 'phase_not_in_plan')),
  -- Phases are never deleted, only switched off; SET NULL is a backstop, and
  -- the app reads a tied line with no phase as every_plan.
  phase_id         UUID REFERENCES coach_phases(id) ON DELETE SET NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coach_sow_lines_coach_idx ON coach_sow_lines (coach_profile_id, section, sort_order);

ALTER TABLE coach_sow_lines ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
