-- ═══════════════════════════════════════════════════
-- SIGNAL Coach-Client System — Phase 1
-- ═══════════════════════════════════════════════════

-- MIGRATION 1: Coach flag on profiles
ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS is_coach BOOLEAN DEFAULT false;

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS coach_org TEXT;

-- MIGRATION 2: Coach-client relationships
CREATE TABLE IF NOT EXISTS coach_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_profile_id UUID NOT NULL
    REFERENCES client_profiles(id) ON DELETE CASCADE,
  client_profile_id UUID
    REFERENCES client_profiles(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','paused','revoked')),

  access_level TEXT NOT NULL DEFAULT 'full'
    CHECK (access_level IN ('view','annotate','full')),

  invited_email TEXT NOT NULL,
  invite_token UUID DEFAULT gen_random_uuid(),
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,

  private_notes TEXT,

  UNIQUE(coach_profile_id, client_profile_id)
);

ALTER TABLE coach_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaches_see_own_clients"
  ON coach_clients FOR ALL
  USING (
    coach_profile_id = (
      SELECT id FROM client_profiles
      WHERE user_id = auth.uid()
    )
    OR
    client_profile_id = (
      SELECT id FROM client_profiles
      WHERE user_id = auth.uid()
    )
  );

-- MIGRATION 3: Coach-sourced job recommendations
CREATE TABLE IF NOT EXISTS coach_job_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  coach_client_id UUID NOT NULL
    REFERENCES coach_clients(id) ON DELETE CASCADE,
  coach_profile_id UUID NOT NULL
    REFERENCES client_profiles(id),
  client_profile_id UUID NOT NULL
    REFERENCES client_profiles(id),

  company_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  job_description TEXT NOT NULL,
  job_url TEXT,

  signal_decision TEXT,
  signal_score INTEGER,
  jobfit_run_id UUID
    REFERENCES jobfit_runs(id) ON DELETE SET NULL,
  persona_id UUID
    REFERENCES client_personas(id) ON DELETE SET NULL,
  persona_name TEXT,

  priority TEXT NOT NULL DEFAULT 'this_week'
    CHECK (priority IN ('urgent','this_week','when_ready','not_recommended')),
  coaching_note TEXT,
  recommended_action TEXT NOT NULL DEFAULT 'apply'
    CHECK (recommended_action IN ('apply','research_first','hold','skip')),
  apply_by_date DATE,

  client_status TEXT DEFAULT 'new'
    CHECK (client_status IN ('new','interested','applying','applied','not_for_me','archived')),
  client_viewed_at TIMESTAMPTZ,
  client_responded_at TIMESTAMPTZ,

  notification_seen BOOLEAN DEFAULT false,

  application_id UUID
    REFERENCES signal_applications(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE coach_job_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaches_and_clients_see_recommendations"
  ON coach_job_recommendations FOR ALL
  USING (
    coach_profile_id = (
      SELECT id FROM client_profiles
      WHERE user_id = auth.uid()
    )
    OR
    client_profile_id = (
      SELECT id FROM client_profiles
      WHERE user_id = auth.uid()
    )
  );

-- MIGRATION 4: Coach annotations
CREATE TABLE IF NOT EXISTS coach_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_profile_id UUID NOT NULL
    REFERENCES client_profiles(id),
  client_profile_id UUID NOT NULL
    REFERENCES client_profiles(id),

  target_type TEXT NOT NULL
    CHECK (target_type IN ('application','jobfit_run','recommendation','general')),
  target_id UUID,

  note TEXT NOT NULL,
  priority TEXT
    CHECK (priority IN ('urgent','important','info','positive',NULL)),

  visible_to_client BOOLEAN DEFAULT true,

  client_acknowledged BOOLEAN DEFAULT false,
  client_acknowledged_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE coach_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach_annotation_access"
  ON coach_annotations FOR ALL
  USING (
    coach_profile_id = (
      SELECT id FROM client_profiles
      WHERE user_id = auth.uid()
    )
    OR
    (
      client_profile_id = (
        SELECT id FROM client_profiles
        WHERE user_id = auth.uid()
      )
      AND visible_to_client = true
    )
  );

-- Update application status constraint to include coach_recommended
ALTER TABLE signal_applications
  DROP CONSTRAINT IF EXISTS signal_applications_application_status_check;
ALTER TABLE signal_applications
  ADD CONSTRAINT signal_applications_application_status_check
  CHECK (application_status IN (
    'saved','applied','interviewing','offer','rejected','withdrawn','coach_recommended'
  ));
