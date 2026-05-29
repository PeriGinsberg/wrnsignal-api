-- Migration: coach_calendar_connections
-- Created: 2026-05-29
-- FRD: docs/Features/coach-calendar-integration-v0-1-frd.md §6.1
-- Scope: dev (apply via Supabase SQL Editor per Foundation Risk 6)
-- Production promotion: deferred until production promotion (separate approval step)
--
-- Stores per-coach Microsoft OAuth tokens + connected-account metadata for
-- the Coach Calendar Integration (Day-view of today's calendar on Coach Home).
-- One connection row per coach (coach_profile_id UNIQUE). Coach-owned table
-- mirroring the coach_client_notes ownership/RLS pattern; tokens are managed
-- server-side via the service-role client, RLS is belt-and-suspenders for
-- direct DB access.

CREATE TABLE IF NOT EXISTS coach_calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One connection per coach. ON DELETE CASCADE so the connection is removed
  -- if the coach profile is deleted. Mirrors coach_clients FK pattern.
  coach_profile_id UUID NOT NULL UNIQUE
    REFERENCES client_profiles(id) ON DELETE CASCADE,

  -- OAuth provider. v0.1 is Microsoft only; CHECK constrains accordingly.
  provider TEXT NOT NULL DEFAULT 'microsoft'
    CHECK (provider IN ('microsoft')),

  -- OAuth tokens + lifetime.
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  scopes TEXT NOT NULL,

  -- Connected Microsoft account metadata (populated from Graph /me on connect).
  microsoft_user_id TEXT,
  microsoft_user_email TEXT,
  microsoft_user_display_name TEXT,

  -- Lifecycle timestamps.
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_refreshed_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Redundant with the UNIQUE constraint above, but kept to mirror the existing
-- coach_clients indexing convention for coach_profile_id lookups.
CREATE INDEX IF NOT EXISTS idx_coach_calendar_connections_coach_profile_id
  ON coach_calendar_connections (coach_profile_id);

ALTER TABLE coach_calendar_connections ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders policy. The API uses service-role + bearer-token +
-- verifyCoach for actual authz; this RLS policy guards against direct DB
-- access. A coach can only see/write their own calendar connection.
CREATE POLICY "coach_calendar_connections_owner_access"
  ON coach_calendar_connections FOR ALL
  USING (
    coach_profile_id = (
      SELECT id FROM client_profiles WHERE user_id = auth.uid()
    )
  );

-- updated_at trigger uses the existing public.set_updated_at() function
-- (DD-07 convention — same function used by coach_clients, coach_client_notes,
-- candidate_targeting, etc.).
CREATE TRIGGER trg_coach_calendar_connections_set_updated_at
  BEFORE UPDATE ON coach_calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
