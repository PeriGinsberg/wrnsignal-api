CREATE TABLE coach_milestone_activities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES coach_milestones(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  owner        TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coach_milestone_activities_owner_valid
    CHECK (owner IN ('coach', 'client', 'both'))
);

CREATE INDEX idx_coach_milestone_activities_milestone_id
  ON coach_milestone_activities (milestone_id);

CREATE TRIGGER trg_coach_milestone_activities_set_updated_at
  BEFORE UPDATE ON coach_milestone_activities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
