-- The coach's SOW settings: the default opening paragraph. 2026-10-10.
--
-- IN PLAIN ENGLISH
--
-- coach_sow_settings: one row per coach, holding the opening paragraph a new
-- client SOW starts with (Settings > Services > SOW). It may contain
-- [First Name], filled from the prospect's name when the SOW is drafted.
-- Saved SOWs keep their own opening; this only pre-fills new ones.
--
-- Additive: a new table. Nothing reads it until the code ships. Safe to run twice.
--
-- Reversibility:
--   DROP TABLE IF EXISTS coach_sow_settings;

CREATE TABLE IF NOT EXISTS coach_sow_settings (
  coach_profile_id UUID PRIMARY KEY REFERENCES client_profiles(id) ON DELETE CASCADE,
  default_opening  TEXT CHECK (default_opening IS NULL OR char_length(default_opening) <= 3000),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_coach_sow_settings_set_updated_at ON coach_sow_settings;
CREATE TRIGGER trg_coach_sow_settings_set_updated_at
  BEFORE UPDATE ON coach_sow_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE coach_sow_settings ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
