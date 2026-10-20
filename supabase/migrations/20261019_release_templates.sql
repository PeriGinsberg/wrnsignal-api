-- The coach's Release-step emails. 2026-10-16.
--
-- IN PLAIN ENGLISH
--
-- coach_release_templates: one row per client step in the coach's library that
-- has an email (Book Resume Workshop, Review draft and book Finalize session,
-- and so on), edited in Settings > Services > Release emails. Each holds a
-- subject, a message and the Calendly link for that step. When that step comes
-- up on a client's plan, the coach gets "Send email": the Message panel opens
-- with the template filled in, and sending it also releases the step.
--
-- A client's step finds its template through source_activity_id, the library
-- step it was copied from. The message may contain [First Name],
-- [Drive folder link] and [Scheduling link]; any other [bracket] is for the
-- coach to fill, and the email cannot go while one is left.
--
-- Additive: a new table. Nothing reads it until the code ships. Safe to run twice.
--
-- Reversibility:
--   DROP TABLE IF EXISTS coach_release_templates;

CREATE TABLE IF NOT EXISTS coach_release_templates (
  activity_id      UUID PRIMARY KEY REFERENCES coach_milestone_activities(id) ON DELETE CASCADE,
  coach_profile_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  subject          TEXT NOT NULL CHECK (char_length(subject) <= 200),
  body             TEXT NOT NULL CHECK (char_length(body) <= 6000),
  scheduling_link  TEXT CHECK (scheduling_link IS NULL OR char_length(scheduling_link) <= 500),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coach_release_templates_coach_idx ON coach_release_templates (coach_profile_id);

DROP TRIGGER IF EXISTS trg_coach_release_templates_set_updated_at ON coach_release_templates;
CREATE TRIGGER trg_coach_release_templates_set_updated_at
  BEFORE UPDATE ON coach_release_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE coach_release_templates ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
