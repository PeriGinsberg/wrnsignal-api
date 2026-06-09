-- Slice 4: per-activity notes.
-- A note hangs off a FROZEN engagement activity. Hybrid of the two existing note
-- systems: deleted_at soft-delete (from coach_client_notes) + visible_to_client
-- (from coach_annotations), but visible_to_client DEFAULTs FALSE — notes are
-- private to the coach unless explicitly shared (like documents), a deliberate
-- divergence from coach_annotations' default-true. action_required is a coach-set
-- flag (no precedent — new). Note dies with its activity (FK CASCADE).
CREATE TABLE coach_client_activity_notes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_activity_id uuid NOT NULL REFERENCES coach_client_engagement_activities(id) ON DELETE CASCADE,
  coach_profile_id       uuid NOT NULL REFERENCES client_profiles(id),
  client_profile_id      uuid NOT NULL REFERENCES client_profiles(id),
  body                   TEXT NOT NULL,
  visible_to_client      BOOLEAN NOT NULL DEFAULT false,
  action_required        BOOLEAN NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);

-- Hot path is "active notes for an activity" — partial index excludes soft-deleted.
CREATE INDEX idx_activity_notes_active
  ON coach_client_activity_notes (engagement_activity_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_activity_notes_set_updated_at
  BEFORE UPDATE ON coach_client_activity_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
