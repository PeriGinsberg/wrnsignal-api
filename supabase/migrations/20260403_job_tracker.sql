-- ============================================================
-- Migration: job tracker tables (applications + interviews)
-- ============================================================

-- 1. signal_applications table
CREATE TABLE signal_applications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id            uuid NOT NULL REFERENCES client_profiles(id)
                        ON DELETE CASCADE,
  persona_id            uuid REFERENCES client_personas(id)
                        ON DELETE SET NULL,
  jobfit_run_id         uuid REFERENCES jobfit_runs(id)
                        ON DELETE SET NULL,

  -- Job info
  company_name          text NOT NULL DEFAULT '',
  job_title             text NOT NULL DEFAULT '',
  location              text DEFAULT '',
  date_posted           date,
  job_url               text DEFAULT '',
  application_location  text DEFAULT '',

  -- Application info
  application_status    text NOT NULL DEFAULT 'saved'
    CHECK (application_status IN
      ('saved','applied','interviewing','offer','rejected','withdrawn')),
  applied_date          date,
  interest_level        int DEFAULT 3 CHECK (interest_level BETWEEN 1 AND 5),
  cover_letter_submitted boolean DEFAULT false,
  referral              boolean DEFAULT false,
  notes                 text DEFAULT '',

  -- SIGNAL enrichment (auto-populated when run through JobFit)
  signal_decision       text DEFAULT '',
  signal_score          int,
  signal_run_at         timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_signal_applications_profile_id
  ON signal_applications(profile_id);
CREATE INDEX idx_signal_applications_status
  ON signal_applications(application_status);

-- 2. signal_interviews table
CREATE TABLE signal_interviews (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES signal_applications(id)
                        ON DELETE CASCADE,
  profile_id            uuid NOT NULL REFERENCES client_profiles(id)
                        ON DELETE CASCADE,

  -- Auto-populated from application
  company_name          text NOT NULL DEFAULT '',
  job_title             text NOT NULL DEFAULT '',

  -- Interview details
  interview_stage       text NOT NULL DEFAULT 'phone'
    CHECK (interview_stage IN (
      'hr_screening','phone','zoom','in_person',
      'take_home','final_round','other'
    )),
  interviewer_names     text DEFAULT '',
  interview_date        date,
  thank_you_sent        boolean DEFAULT false,
  status                text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN (
      'not_scheduled','scheduled','awaiting_feedback',
      'offer_extended','rejected','ghosted'
    )),
  confidence_level      int DEFAULT 3
                        CHECK (confidence_level BETWEEN 1 AND 5),
  notes                 text DEFAULT '',

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_signal_interviews_application_id
  ON signal_interviews(application_id);
CREATE INDEX idx_signal_interviews_profile_id
  ON signal_interviews(profile_id);

-- 3. Link jobfit_runs to signal_applications
ALTER TABLE jobfit_runs
  ADD COLUMN IF NOT EXISTS application_id uuid
  REFERENCES signal_applications(id) ON DELETE SET NULL;
