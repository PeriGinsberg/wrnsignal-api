-- Plan tasks, pass A. 2026-10-05.
--
-- IN PLAIN ENGLISH
--
-- 1. Every deliverable task is a Coach task or a Client task. The old third
--    value, "both", becomes Coach (library and clients' copies alike): a
--    coach drives it, and it is no longer shown to the client.
-- 2. A client's copy of a task has a STATE: Upcoming, Active, Waiting on
--    client (a released client task), Done, Skipped or Not needed. It also has
--    an assignee (the client's coach unless changed) and the time it was
--    released. The old three-way status is kept, but the database now works it
--    out from the state (Done and Skipped read "complete"; Active and Waiting
--    read "in progress"; the rest "not started"), so the screens that still
--    read it keep working and nobody can set the two apart.
-- 3. A client's copy of a deliverable can be marked Not needed: it stays on the
--    plan, greyed, and its tasks never activate.
-- 4. Existing tasks move over, as agreed on 2026-10-03:
--      approved packages:  complete -> Done
--                          coach task in progress -> Active
--                          client task not started or in progress
--                            -> Waiting on client, released on the date the
--                               package was approved (its "Proposal approved"
--                               History line, else the date it was attached)
--                          coach task not started -> Upcoming
--      other packages:     complete -> Done, everything else -> Upcoming
--                          (nothing activates before approval)
--
-- Reversibility (the old status values are untouched by the move, except
-- where "both" became coach and the trigger re-derives them):
--   DROP TRIGGER IF EXISTS trg_ccea_status_from_state ON coach_client_engagement_activities;
--   DROP FUNCTION IF EXISTS public.ccea_status_from_state();
--   ALTER TABLE coach_client_engagement_activities
--     DROP COLUMN IF EXISTS state, DROP COLUMN IF EXISTS assignee_profile_id,
--     DROP COLUMN IF EXISTS released_at, DROP COLUMN IF EXISTS state_changed_at;
--   ALTER TABLE coach_client_engagement_deliverables DROP COLUMN IF EXISTS not_needed;
--   (owner "both" cannot be restored: the move does not record which rows were.)

BEGIN;

-- ── 1. Coach or Client ──────────────────────────────────────────────────────

UPDATE coach_milestone_activities SET owner = 'coach' WHERE owner = 'both';
UPDATE coach_client_engagement_activities SET owner = 'coach' WHERE owner = 'both';

ALTER TABLE coach_milestone_activities DROP CONSTRAINT IF EXISTS coach_milestone_activities_owner_valid;
ALTER TABLE coach_milestone_activities
  ADD CONSTRAINT coach_milestone_activities_owner_valid CHECK (owner IN ('coach', 'client'));
ALTER TABLE coach_client_engagement_activities DROP CONSTRAINT IF EXISTS ccea_owner_valid;
ALTER TABLE coach_client_engagement_activities
  ADD CONSTRAINT ccea_owner_valid CHECK (owner IN ('coach', 'client'));

-- ── 2. State, assignee, release time ────────────────────────────────────────

ALTER TABLE coach_client_engagement_activities
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'upcoming',
  ADD COLUMN IF NOT EXISTS assignee_profile_id UUID REFERENCES client_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS state_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE coach_client_engagement_activities DROP CONSTRAINT IF EXISTS ccea_state_valid;
ALTER TABLE coach_client_engagement_activities
  ADD CONSTRAINT ccea_state_valid
  CHECK (state IN ('upcoming', 'active', 'waiting_on_client', 'done', 'skipped', 'not_needed'));

CREATE INDEX IF NOT EXISTS idx_ccea_assignee_active
  ON coach_client_engagement_activities (assignee_profile_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS idx_ccea_waiting
  ON coach_client_engagement_activities (released_at) WHERE state = 'waiting_on_client';

-- The old status follows the state, always.
CREATE OR REPLACE FUNCTION public.ccea_status_from_state() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.status := CASE
    WHEN NEW.state IN ('done', 'skipped') THEN 'complete'
    WHEN NEW.state IN ('active', 'waiting_on_client') THEN 'in_progress'
    ELSE 'not_started'
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ccea_status_from_state ON coach_client_engagement_activities;
CREATE TRIGGER trg_ccea_status_from_state
  BEFORE INSERT OR UPDATE ON coach_client_engagement_activities
  FOR EACH ROW EXECUTE FUNCTION public.ccea_status_from_state();

-- ── 3. Not needed, on a client's deliverable ────────────────────────────────

ALTER TABLE coach_client_engagement_deliverables
  ADD COLUMN IF NOT EXISTS not_needed BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 4. Move existing tasks ──────────────────────────────────────────────────
-- Reads the OLD status, so it runs only while every row is still on the
-- 'upcoming' default (a second run changes nothing).

WITH eng AS (
  SELECT e.id, e.proposal_status, cc.coach_profile_id,
         COALESCE((
           SELECT max(ev.created_at) FROM coach_client_events ev
           WHERE ev.coach_client_id = e.coach_client_id
             AND ev.event_type = 'proposal_approved'
             AND ev.context->>'name' = e.name
         ), e.attached_at) AS approved_at
  FROM coach_client_engagements e
  JOIN coach_clients cc ON cc.id = e.coach_client_id
),
moved AS (
  SELECT a.id,
    CASE
      WHEN a.status = 'complete' THEN 'done'
      WHEN eng.proposal_status <> 'approved' THEN 'upcoming'
      WHEN a.owner = 'client' THEN 'waiting_on_client'
      WHEN a.status = 'in_progress' THEN 'active'
      ELSE 'upcoming'
    END AS state,
    CASE
      WHEN a.status <> 'complete' AND eng.proposal_status = 'approved' AND a.owner = 'client'
        THEN eng.approved_at
    END AS released_at,
    eng.coach_profile_id
  FROM coach_client_engagement_activities a
  JOIN coach_client_engagement_deliverables d ON d.id = a.engagement_deliverable_id
  JOIN eng ON eng.id = d.engagement_id
  WHERE a.state = 'upcoming'
    AND NOT EXISTS (SELECT 1 FROM coach_client_engagement_activities x WHERE x.state <> 'upcoming')
)
UPDATE coach_client_engagement_activities a
   SET state = moved.state,
       released_at = moved.released_at,
       assignee_profile_id = COALESCE(a.assignee_profile_id, moved.coach_profile_id)
  FROM moved
 WHERE a.id = moved.id;

-- Every task has someone to act on it: the client's coach unless set.
UPDATE coach_client_engagement_activities a
   SET assignee_profile_id = cc.coach_profile_id
  FROM coach_client_engagement_deliverables d
  JOIN coach_client_engagements e ON e.id = d.engagement_id
  JOIN coach_clients cc ON cc.id = e.coach_client_id
 WHERE d.id = a.engagement_deliverable_id AND a.assignee_profile_id IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
