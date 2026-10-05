-- The coach's welcome email templates. 2026-10-13.
--
-- IN PLAIN ENGLISH
--
-- coach_welcome_templates: one row per coach per starting point (Your SIGNAL
-- DNA, Resume Workshop, Search, Land), edited in Settings > Services >
-- Welcome emails. Each holds a subject, a message and the Calendly link for
-- that first session. When the coach ticks "Send welcome email (releases:
-- [task])", the editor opens with the template that matches the phase of that
-- task's deliverable. The message may contain [First Name], [Drive folder link]
-- and [Scheduling link].
--
-- Additive: a new table. Nothing reads it until the code ships. Safe to run twice.
--
-- Reversibility:
--   DROP TABLE IF EXISTS coach_welcome_templates;

CREATE TABLE IF NOT EXISTS coach_welcome_templates (
  coach_profile_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  start_key        TEXT NOT NULL CHECK (start_key IN ('dna', 'resume_workshop', 'search', 'land')),
  subject          TEXT NOT NULL CHECK (char_length(subject) <= 200),
  body             TEXT NOT NULL CHECK (char_length(body) <= 6000),
  scheduling_link  TEXT CHECK (scheduling_link IS NULL OR char_length(scheduling_link) <= 500),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (coach_profile_id, start_key)
);

DROP TRIGGER IF EXISTS trg_coach_welcome_templates_set_updated_at ON coach_welcome_templates;
CREATE TRIGGER trg_coach_welcome_templates_set_updated_at
  BEFORE UPDATE ON coach_welcome_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE coach_welcome_templates ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
