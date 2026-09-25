-- ═══════════════════════════════════════════════════
-- SIGNAL coaching tasks — 2026-09-26
-- ═══════════════════════════════════════════════════
--
-- Step 1 of docs/coaching-task-automation-plan.md: moving coaching task
-- automation out of GoHighLevel and into SIGNAL.
--
-- IN PLAIN ENGLISH
--
-- Today an "Action Item" is a row in coach_client_notes with type =
-- 'action_item'. There are 55 of them in prod. That table also holds session
-- recaps, prospect notes, activity notes and coaching notes, and fourteen route
-- files read it.
--
-- A task needs an assignee (required), a client (optional), a due date, a
-- status, where it came from, and which template produced it. Three of those
-- invert what coach_client_notes encodes: its coach_client_id is NOT NULL and
-- anchors a note to one coach-client pair, its coach_profile_id is the owner
-- rather than an assignee, and its client is mandatory. Bolting seven columns
-- onto a table serving five unrelated features would make every one of them
-- carry constraints it has no use for.
--
-- So: a table of its own. The 55 existing action items move across in
-- 20260926_coach_tasks_backfill.sql, which keeps the originals in place.
--
-- Reversibility:
--   DROP TABLE coach_task_events;
--   DROP TABLE coach_tasks;
--
-- Nothing else references either table yet, and the backfill does not modify
-- coach_client_notes, so dropping both returns the database to where it started.

-- ---------------------------------------------------------------------------
-- 1. The task
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coach_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  title       TEXT NOT NULL,
  description TEXT,

  -- OPTIONAL, unlike coach_client_notes. "Renew the Postmark domain" is a real
  -- task and belongs to no client.
  client_profile_id UUID REFERENCES client_profiles(id),

  -- Set when the task is client-scoped. SET NULL rather than CASCADE: if a
  -- coach-client link is torn down, the work someone still has to do does not
  -- silently vanish from their list.
  coach_client_id UUID REFERENCES coach_clients(id) ON DELETE SET NULL,

  -- REQUIRED, and frequently a different coach from whoever created the task.
  -- Must be a client_profiles row with is_coach = true. Postgres cannot express
  -- that in a foreign key, so it is enforced in lib/tasks/service.ts on write
  -- and asserted by the nightly digest job. A trigger was considered and
  -- rejected: it would fire on every write to catch an error the API layer
  -- already refuses to make.
  assignee_profile_id UUID NOT NULL REFERENCES client_profiles(id),

  -- NULL when source = 'auto'. Nobody created it; a rule did.
  created_by_profile_id UUID REFERENCES client_profiles(id),

  due_at TIMESTAMPTZ,

  -- "Due date, time optional" without a second column. A date plus a separate
  -- time would make every overdue comparison reassemble the two and decide what
  -- a missing time means; one timestamptz keeps overdue as a single comparison
  -- and this flag only changes how the date renders.
  due_has_time BOOLEAN NOT NULL DEFAULT FALSE,

  -- No in_progress: decided 2026-09-24. A reopened task returns to 'open' and
  -- the reason lives in coach_task_events.
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','done','cancelled')),

  completed_at TIMESTAMPTZ,
  -- The two cannot disagree. A 'done' task without a completion time, or an
  -- open task carrying one, is a bug that would quietly corrupt the digest.
  CONSTRAINT coach_tasks_completed_matches_status
    CHECK ((status = 'done') = (completed_at IS NOT NULL)),

  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','auto')),

  -- Which template produced it. Set in 20260926_coach_task_automation.sql,
  -- which adds the foreign key once coach_task_templates exists.
  template_id UUID,

  -- Groups the four Networking tasks belonging to one client's run.
  chain_id UUID,

  -- Traceability back to the coach_client_notes row this came from, and what
  -- makes the backfill safe to run twice: the UNIQUE constraint means a second
  -- run inserts nothing rather than duplicating all 55.
  legacy_note_id UUID UNIQUE REFERENCES coach_client_notes(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Soft delete, matching coach_client_notes. NULL = visible.
  deleted_at TIMESTAMPTZ
);

-- The dashboard card ("my overdue + due this week") and the full list's default
-- "assignee = me" filter both start here.
CREATE INDEX IF NOT EXISTS coach_tasks_assignee_idx
  ON coach_tasks (assignee_profile_id, status, due_at)
  WHERE deleted_at IS NULL;

-- The client tab, and the per-client filter on the full list.
CREATE INDEX IF NOT EXISTS coach_tasks_client_idx
  ON coach_tasks (client_profile_id, status, due_at)
  WHERE deleted_at IS NULL AND client_profile_id IS NOT NULL;

-- The nightly overdue digest sweeps every coach at once.
CREATE INDEX IF NOT EXISTS coach_tasks_overdue_idx
  ON coach_tasks (due_at)
  WHERE deleted_at IS NULL AND status = 'open' AND due_at IS NOT NULL;

-- Automation looks up "is there an open task from template X for this client",
-- which is the question complete_task and reopen_task both ask.
CREATE INDEX IF NOT EXISTS coach_tasks_template_open_idx
  ON coach_tasks (template_id, client_profile_id)
  WHERE deleted_at IS NULL AND status = 'open';

ALTER TABLE coach_tasks ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders, mirroring coach_client_notes_owner_access. The API uses
-- service-role plus bearer token for real authz; this guards direct DB access.
--
-- Wider than the notes policy on purpose: a task is visible to the person it is
-- assigned to AND to whoever created it, because reassigning a task away from
-- yourself must not make it disappear from your own view before you have
-- confirmed it landed.
-- CREATE POLICY has no IF NOT EXISTS, and everything else in this file is safe
-- to re-run. Dropping first keeps the whole migration re-runnable, which is how
-- the gap was found: a second pass failed here with 42710 and nowhere else.
DROP POLICY IF EXISTS "coach_tasks_assignee_or_creator_access" ON coach_tasks;
CREATE POLICY "coach_tasks_assignee_or_creator_access"
  ON coach_tasks FOR ALL
  USING (
    assignee_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid())
    OR created_by_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 2. The audit trail
-- ---------------------------------------------------------------------------
-- Every mutation writes one row here. This is also where "Request Changes"
-- notes live: reopening the campaign task has to carry Peri's reason without
-- overwriting the description Erin is working from.
CREATE TABLE IF NOT EXISTS coach_task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  task_id UUID NOT NULL REFERENCES coach_tasks(id) ON DELETE CASCADE,

  kind TEXT NOT NULL
    CHECK (kind IN ('created','assigned','reassigned','completed','reopened','cancelled','commented')),

  -- NULL when the actor was a rule rather than a person.
  actor_profile_id UUID REFERENCES client_profiles(id),

  note    TEXT,
  payload JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coach_task_events_task_idx
  ON coach_task_events (task_id, created_at DESC);

ALTER TABLE coach_task_events ENABLE ROW LEVEL SECURITY;

-- Visible exactly when the task it belongs to is visible.
DROP POLICY IF EXISTS "coach_task_events_follow_task" ON coach_task_events;
CREATE POLICY "coach_task_events_follow_task"
  ON coach_task_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM coach_tasks t
      WHERE t.id = coach_task_events.task_id
        AND (
          t.assignee_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid())
          OR t.created_by_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid())
        )
    )
  );

NOTIFY pgrst, 'reload schema';
