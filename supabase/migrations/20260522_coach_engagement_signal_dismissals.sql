-- ═══════════════════════════════════════════════════
-- SIGNAL Coaches Center — engagement signal dismissals (2026-05-22)
-- ═══════════════════════════════════════════════════
--
-- Phase 3 Commit 3.2 (Items 7+8). Lets a coach dismiss an engagement
-- signal produced by the R1-R6 heuristic engine (see
-- app/api/_lib/coachEngagementHeuristics.ts shipped Phase 3.0).
-- Dismissal is permanent and syncs across all three surfaces
-- (Coach Home, Client Dashboard NeedsAttention, Required Actions full
-- page) because the engine reads dismissals at the top of runHeuristics()
-- and filters out matching signal IDs before returning.
--
-- signal_key = the engine's emitted `id` field directly — no separate
-- key construction. Engine ID formats (locked Phase 3.0):
--   R1 → r1:<client_profile_id>
--   R2 → r2:<recommendation_id>
--   R3 → moved_interviewing:<application_id>
--   R4 → moved_rejected:<application_id>
--   R5 → offer_no_followup:<application_id>
--   R6 → r6:<application_id>
--
-- UNIQUE(coach_profile_id, signal_key) enables ON CONFLICT DO NOTHING on
-- the dismiss endpoint — re-firing the same signal (e.g. coach re-clicks
-- after Undo expired) is idempotent.
--
-- Reversibility:
--   DROP INDEX IF EXISTS idx_signal_dismissals_coach;
--   DROP TABLE coach_engagement_signal_dismissals;

CREATE TABLE coach_engagement_signal_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_profile_id UUID NOT NULL REFERENCES client_profiles(id),
  signal_key TEXT NOT NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(coach_profile_id, signal_key)
);

CREATE INDEX idx_signal_dismissals_coach
  ON coach_engagement_signal_dismissals(coach_profile_id);
