-- Add full_analysis JSONB to coach_job_recommendations
ALTER TABLE coach_job_recommendations
ADD COLUMN IF NOT EXISTS full_analysis JSONB;

-- Add sourced_by_coach_id to jobfit_runs
ALTER TABLE jobfit_runs
ADD COLUMN IF NOT EXISTS sourced_by_coach_id UUID
  REFERENCES client_profiles(id);
