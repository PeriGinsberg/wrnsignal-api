-- Migration: coach_milestones (Coach Deliverables Library — Phase 1)
-- Reconstructed from live dev DDL + docs/coach-deliverables-phase1-spec.md §2.
-- Original CREATE was applied to dev via SQL Editor (dev schema_migrations drift,
-- "Risk 6") and never committed as a file. time_estimate_days + fee_cents are
-- added by the companion 20260604_coach_milestones_add_estimate_fee.sql.
CREATE TABLE coach_milestones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_profile_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  category         TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_coach_milestones_coach_profile_id ON coach_milestones (coach_profile_id);

CREATE TRIGGER trg_coach_milestones_set_updated_at
  BEFORE UPDATE ON coach_milestones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
