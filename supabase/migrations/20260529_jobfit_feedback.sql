-- =============================================================================
-- jobfit_feedback — DEV-ONLY structured rating capture on JobFit runs.
--
-- ⚠️  DEV-ONLY TABLE. NEVER PROMOTE TO PROD.
--
-- This table backs an internal QA feedback widget used by WRN testers
-- (Maleri et al.) to rate JobFit results on dev. It is NOT a product
-- feature. The route, frontend widget, and schema are all gated to dev
-- environment via lib/devOnly.ts. Runlog row for this migration is
-- marked ❌ never for prod.
--
-- If this table ever needs to ship to prod (real user feedback capture),
-- it should be REBUILT from scratch — not promoted as-is. Production
-- version would need: ON DELETE SET NULL with inline snapshots of
-- result_json/persona context (to survive jobfit_runs deletion), RLS
-- policies, real auth scoping, and a thought-through retention policy.
-- This dev-only version intentionally cuts corners for testing speed.
--
-- Apply via Supabase SQL Editor on dev only (zydrqckpwidipwbhrfgd).
-- =============================================================================

CREATE TABLE jobfit_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jobfit_run_id UUID NOT NULL REFERENCES jobfit_runs(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES client_profiles(id),
  rating TEXT NOT NULL CHECK (rating IN ('good', 'mixed', 'bad')),
  categories TEXT[] NOT NULL DEFAULT '{}',
  feedback_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Force structure when rating is not 'good': either categories or
  -- freetext must be present. 'good' ratings can land bare.
  CONSTRAINT jobfit_feedback_non_good_requires_detail CHECK (
    rating = 'good'
    OR array_length(categories, 1) > 0
    OR (feedback_text IS NOT NULL AND length(trim(feedback_text)) > 0)
  )
);

CREATE INDEX idx_jobfit_feedback_run_id ON jobfit_feedback(jobfit_run_id);
CREATE INDEX idx_jobfit_feedback_profile_id ON jobfit_feedback(profile_id);
CREATE INDEX idx_jobfit_feedback_created_at ON jobfit_feedback(created_at DESC);
CREATE INDEX idx_jobfit_feedback_rating ON jobfit_feedback(rating);

-- =============================================================================
-- Sample queries for triage (run in Supabase SQL Editor when reviewing)
-- =============================================================================

-- Latest feedback per (run, profile) — useful when testers re-rate
-- after a code change.
--
--   SELECT DISTINCT ON (jobfit_run_id, profile_id)
--     id, jobfit_run_id, profile_id, rating, categories, feedback_text, created_at
--   FROM jobfit_feedback
--   ORDER BY jobfit_run_id, profile_id, created_at DESC;

-- All 'bad' ratings with full JobFit context (verdict, score, result_json).
--
--   SELECT
--     f.created_at,
--     f.rating,
--     f.categories,
--     f.feedback_text,
--     jr.verdict,
--     (jr.result_json->>'score')::int AS score,
--     jr.result_json->'job_signals'->>'companyName' AS company,
--     jr.result_json->'job_signals'->>'jobTitle' AS title,
--     jr.id AS jobfit_run_id
--   FROM jobfit_feedback f
--   JOIN jobfit_runs jr ON jr.id = f.jobfit_run_id
--   WHERE f.rating = 'bad'
--   ORDER BY f.created_at DESC;

-- Category frequency rollup — which failure modes are most common.
--
--   SELECT
--     unnest(categories) AS category,
--     COUNT(*) AS hits
--   FROM jobfit_feedback
--   WHERE rating <> 'good'
--   GROUP BY category
--   ORDER BY hits DESC;

-- All freetext for qualitative review.
--
--   SELECT
--     f.created_at,
--     f.rating,
--     f.feedback_text,
--     jr.verdict,
--     jr.result_json->'job_signals'->>'companyName' AS company,
--     jr.result_json->'job_signals'->>'jobTitle' AS title
--   FROM jobfit_feedback f
--   JOIN jobfit_runs jr ON jr.id = f.jobfit_run_id
--   WHERE f.feedback_text IS NOT NULL
--   ORDER BY f.created_at DESC;
