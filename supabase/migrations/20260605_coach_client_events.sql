-- 20260605_coach_client_events.sql
--
-- Per-relationship business event log on coach_clients — an append-only audit
-- timeline (prospect_created, stage_changed, converted, proposal_*, engagement
-- attached/detached, invite_sent, …). Application-logged, log-forward, read as a
-- timeline.
--
-- APPEND-ONLY BY DESIGN: no updated_at, no set_updated_at trigger, and NO CHECK
-- on event_type — event_type is typed in application code and never user input,
-- so a DB CHECK would only add churn each time a new event type ships. Do not add
-- any of those.
--
-- actor_profile_id is the acting coach's client_profiles.id (ON DELETE SET NULL,
-- so deleting a profile preserves the event with a null actor). coach_client_id
-- CASCADEs (the log lives and dies with the relationship). context holds
-- event-specific detail (e.g. { new_status }, { stage_key }).
--
-- DEV ENV ONLY. Applied to DEV (zydrqckpwidipwbhrfgd) via direct Postgres. Do
-- NOT promote to prod (joins the closed-gate pile).

CREATE TABLE coach_client_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_client_id  UUID NOT NULL REFERENCES coach_clients(id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL,
  actor_profile_id UUID REFERENCES client_profiles(id) ON DELETE SET NULL,
  context          JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_coach_client_events_coach_client_id_created
  ON coach_client_events (coach_client_id, created_at DESC);
