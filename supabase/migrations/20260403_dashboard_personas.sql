-- ============================================================
-- Migration: dashboard personas + profile versioning
-- ============================================================

-- 1. Add profile_version to client_profiles
ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS profile_version int NOT NULL DEFAULT 1;

-- 2. Create client_personas table
CREATE TABLE client_personas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  name          text NOT NULL DEFAULT 'My Resume',
  resume_text   text NOT NULL DEFAULT '',
  is_default    boolean NOT NULL DEFAULT false,
  display_order int NOT NULL DEFAULT 1,
  persona_version int NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_personas_profile_id ON client_personas(profile_id);

-- 3. Add persona tracking columns to jobfit_runs
ALTER TABLE jobfit_runs
  ADD COLUMN IF NOT EXISTS persona_id uuid REFERENCES client_personas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS profile_version_at_run int,
  ADD COLUMN IF NOT EXISTS persona_version_at_run int;

-- 4. Seed: create one default persona per existing profile
INSERT INTO client_personas (profile_id, name, resume_text, is_default, display_order)
SELECT
  id,
  'My Resume',
  COALESCE(resume_text, ''),
  true,
  1
FROM client_profiles
WHERE NOT EXISTS (
  SELECT 1 FROM client_personas cp WHERE cp.profile_id = client_profiles.id
);
