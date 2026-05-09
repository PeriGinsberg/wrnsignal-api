-- ═══════════════════════════════════════════════════
-- SIGNAL Coach-Client Notes (typed, multi-row) — 2026-05-09
-- ═══════════════════════════════════════════════════
--
-- Phase 1 of the Client Dashboard build (May 8 design session).
-- Foundation for typed, soft-deletable, completion-trackable notes that a
-- coach writes about a specific client. Distinct from the legacy
-- `coach_clients.private_notes` single TEXT column, which is left in place.
--
-- Phases 2-4 build on this:
--   - Phase 2: per-client "Needs Attention" query joins this table
--     (open action items where completed_at IS NULL).
--   - Phase 3: dashboard surfaces recent notes + needs-attention list.
--   - Phase 4: cross-client Required Actions tab joins open action items.
--
-- Reversibility:
--   DROP TABLE coach_client_notes;
--
-- (Dropping the table is safe since nothing else references it; the
-- legacy `coach_clients.private_notes` field is independent.)

CREATE TABLE IF NOT EXISTS coach_client_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Anchor to the coach-client relationship row. Cascade-deletes if a
  -- coach-client link is fully removed (matches coach_job_recommendations
  -- pattern).
  coach_client_id UUID NOT NULL
    REFERENCES coach_clients(id) ON DELETE CASCADE,

  -- Denormalized for index-only filtered queries without a join. Same
  -- pattern as coach_job_recommendations.
  coach_profile_id  UUID NOT NULL REFERENCES client_profiles(id),
  client_profile_id UUID NOT NULL REFERENCES client_profiles(id),

  -- Required enum. Notes default to 'session_recap'; coach can change to
  -- action_item or other. Spec originally allowed untyped notes; rejected
  -- 2026-05-09 in favor of always-typed for clearer downstream queries
  -- (Phase 2 needs-attention only cares about action_item; counting
  -- untyped + other separately added no value).
  type TEXT NOT NULL DEFAULT 'session_recap'
    CHECK (type IN ('session_recap','action_item','other')),

  body TEXT NOT NULL,

  -- Priority. Only meaningful for type = 'action_item'; feeds Phase 2
  -- "Needs Attention" ranking and Phase 4 cross-client Required Actions.
  -- Vocabulary mirrors coach_job_recommendations.priority for consistency
  -- across surfaces ('not_recommended' is excluded — an action item by
  -- definition is something to do).
  priority TEXT
    CHECK (priority IS NULL OR priority IN ('urgent','this_week','when_ready')),
  CONSTRAINT coach_client_notes_priority_only_action_items
    CHECK (priority IS NULL OR type = 'action_item'),

  -- Only meaningful for type = 'action_item'. Set when the coach checks
  -- the completion box; cleared when unchecked. Constraint enforces the
  -- "only meaningful for action items" semantic at the DB level.
  completed_at TIMESTAMPTZ,
  CONSTRAINT coach_client_notes_completion_only_action_items
    CHECK (completed_at IS NULL OR type = 'action_item'),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Soft delete. NULL = visible. The UI never surfaces rows with
  -- deleted_at IS NOT NULL.
  deleted_at TIMESTAMPTZ
);

-- Primary list query: chronological feed for one coach-client pair,
-- optionally filtered by type. Partial index on the active rows because
-- soft-deleted notes are never displayed.
CREATE INDEX IF NOT EXISTS coach_client_notes_active_idx
  ON coach_client_notes (coach_profile_id, client_profile_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Phase 2/4 hot path: open action items by coach (cross-client) and by
-- (coach, client) (per-client). Partial index keeps it tight since most
-- notes won't be open action items. Includes priority in the index so
-- the eventual ranked Needs-Attention query stays fast.
CREATE INDEX IF NOT EXISTS coach_client_notes_open_action_items_idx
  ON coach_client_notes (coach_profile_id, client_profile_id, priority, created_at DESC)
  WHERE deleted_at IS NULL
    AND type = 'action_item'
    AND completed_at IS NULL;

ALTER TABLE coach_client_notes ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders policy. The API uses service-role + bearer-token +
-- verifyCoachAccess for actual authz; this RLS policy guards against
-- direct DB access. A coach can only see/write their own notes.
CREATE POLICY "coach_client_notes_owner_access"
  ON coach_client_notes FOR ALL
  USING (
    coach_profile_id = (
      SELECT id FROM client_profiles WHERE user_id = auth.uid()
    )
  );
