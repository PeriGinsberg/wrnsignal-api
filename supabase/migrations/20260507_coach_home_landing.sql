-- ═══════════════════════════════════════════════════
-- SIGNAL Sprint 2 — Coach Home / "since last visit" (2026-05-07)
-- ═══════════════════════════════════════════════════
--
-- Adds:
--   - coach_clients.last_viewed_at — bumped when the coach opens a
--     client's dashboard. Powers "since last visit" indicator on the
--     My Clients cards AND the "no recent coach activity" predicate
--     in the Requires Action heuristics.
--
--   - signal_applications_status_history — append-only log of every
--     application_status transition. Powers heuristic rules tied to
--     "moved to Interviewing N days ago", "rejected N days ago", etc.
--     Eight writers (4 inserts + 4 updates) emit rows via the helper
--     in app/api/_lib/applicationStatusHistory.ts.
--
-- Decisions (2026-05-07):
--   - NO BACKFILL of historical transitions (decision in prompt).
--     Heuristic rules tied to history will be quiet for ~7 days
--     post-launch until enough new transitions accumulate.
--   - changed_by → ON DELETE SET NULL preserves history when a
--     profile is removed. application_id → ON DELETE CASCADE because
--     history without its application has no value.
--
-- Reversibility:
--   ALTER TABLE coach_clients DROP COLUMN last_viewed_at;
--   DROP TABLE signal_applications_status_history;

ALTER TABLE coach_clients
  ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS signal_applications_status_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES signal_applications(id) ON DELETE CASCADE,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by     UUID REFERENCES client_profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS signal_applications_status_history_app_idx
  ON signal_applications_status_history(application_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS signal_applications_status_history_changed_at_idx
  ON signal_applications_status_history(changed_at DESC);
