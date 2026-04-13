-- Resume Rx sessions table
CREATE TABLE IF NOT EXISTS resume_rx_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL
    REFERENCES client_profiles(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'diagnosis'
    CHECK (status IN (
      'diagnosis','education','architecture',
      'qa','validation','complete'
    )),

  -- Inputs
  original_resume_text TEXT NOT NULL,
  mode TEXT NOT NULL,
  year_in_school TEXT NOT NULL,
  target_field TEXT NOT NULL,
  source_persona_id UUID
    REFERENCES client_personas(id) ON DELETE SET NULL,

  -- Stage outputs (JSONB)
  diagnosis JSONB,
  education_intake JSONB,
  architecture JSONB,
  qa_items JSONB DEFAULT '[]'::jsonb,
  approved_bullets JSONB DEFAULT '[]'::jsonb,
  validation_result JSONB,

  -- Final outputs
  coaching_summary TEXT,
  final_resume_text TEXT,
  pdf_url TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE resume_rx_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_rx_sessions"
  ON resume_rx_sessions FOR ALL
  USING (
    profile_id = (
      SELECT id FROM client_profiles
      WHERE user_id = auth.uid()
    )
  );
