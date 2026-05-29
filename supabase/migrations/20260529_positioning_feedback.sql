-- =============================================================================
-- positioning_feedback — DEV-ONLY structured rating capture on Positioning v2 runs.
--
-- ⚠️  DEV-ONLY TABLE. NEVER PROMOTE TO PROD.
--
-- Mirror of jobfit_feedback, scoped to positioning_runs_v2. See
-- jobfit_feedback migration header for the full dev-only rationale.
--
-- Apply via Supabase SQL Editor on dev only (zydrqckpwidipwbhrfgd).
-- =============================================================================

CREATE TABLE positioning_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  positioning_run_id UUID NOT NULL REFERENCES positioning_runs_v2(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES client_profiles(id),
  rating TEXT NOT NULL CHECK (rating IN ('good', 'mixed', 'bad')),
  categories TEXT[] NOT NULL DEFAULT '{}',
  feedback_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT positioning_feedback_non_good_requires_detail CHECK (
    rating = 'good'
    OR array_length(categories, 1) > 0
    OR (feedback_text IS NOT NULL AND length(trim(feedback_text)) > 0)
  )
);

CREATE INDEX idx_positioning_feedback_run_id ON positioning_feedback(positioning_run_id);
CREATE INDEX idx_positioning_feedback_profile_id ON positioning_feedback(profile_id);
CREATE INDEX idx_positioning_feedback_created_at ON positioning_feedback(created_at DESC);
CREATE INDEX idx_positioning_feedback_rating ON positioning_feedback(rating);

-- =============================================================================
-- Sample queries for triage
-- =============================================================================

-- Latest feedback per (run, profile).
--
--   SELECT DISTINCT ON (positioning_run_id, profile_id)
--     id, positioning_run_id, profile_id, rating, categories, feedback_text, created_at
--   FROM positioning_feedback
--   ORDER BY positioning_run_id, profile_id, created_at DESC;

-- All 'bad' ratings with full Positioning context (case, reasoning).
--
--   SELECT
--     f.created_at,
--     f.rating,
--     f.categories,
--     f.feedback_text,
--     pr.case_assigned,
--     pr.case_specific->>'reasoning' AS case_reasoning,
--     pr.id AS positioning_run_id
--   FROM positioning_feedback f
--   JOIN positioning_runs_v2 pr ON pr.id = f.positioning_run_id
--   WHERE f.rating = 'bad'
--   ORDER BY f.created_at DESC;

-- Case-letter rollup — are bad ratings concentrated on one case?
--
--   SELECT
--     pr.case_assigned,
--     f.rating,
--     COUNT(*) AS hits
--   FROM positioning_feedback f
--   JOIN positioning_runs_v2 pr ON pr.id = f.positioning_run_id
--   GROUP BY pr.case_assigned, f.rating
--   ORDER BY pr.case_assigned, f.rating;

-- Category frequency rollup.
--
--   SELECT
--     unnest(categories) AS category,
--     COUNT(*) AS hits
--   FROM positioning_feedback
--   WHERE rating <> 'good'
--   GROUP BY category
--   ORDER BY hits DESC;
