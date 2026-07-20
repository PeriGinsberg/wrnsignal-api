CREATE TABLE coach_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_profile_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  client_profile_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  function_type TEXT NOT NULL CHECK (function_type IN ('jobfit','positioning','coverletter','networking')),
  run_id UUID NOT NULL,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'coach_private' CHECK (visibility IN ('coach_private','client_visible')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_coach_notes_coach_client ON coach_notes(coach_profile_id, client_profile_id);
CREATE INDEX idx_coach_notes_run ON coach_notes(function_type, run_id);
CREATE TRIGGER trg_coach_notes_set_updated_at BEFORE UPDATE ON coach_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
