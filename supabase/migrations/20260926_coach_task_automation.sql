-- ═══════════════════════════════════════════════════
-- SIGNAL task automation: events, rules, templates — 2026-09-26
-- ═══════════════════════════════════════════════════
--
-- Step 1 of docs/coaching-task-automation-plan.md, second half.
--
-- IN PLAIN ENGLISH
--
-- The Networking chain is four tasks. Erin builds a campaign, Peri reviews it,
-- Peri uploads it and builds the plan, Peri shares it with the client. Three of
-- those four are created or completed by the system rather than by a person.
--
-- None of that chain is written in code. It is rows in these three tables:
--
--   coach_task_templates      what a task looks like when it is created
--   coach_automation_events   something happened
--   coach_automation_rules    when THIS happens, do THAT
--
-- Adding a second chain later is rows, not a deploy. That is the whole point of
-- moving this out of GoHighLevel rather than reimplementing it in TypeScript.
--
-- WHY EVENTS ARE A TABLE RATHER THAN A FUNCTION CALL
--
-- The first event in the chain fires when a client submits their profile. If
-- rules ran inline inside that request, a rule that threw would take the
-- client's form submission down with it. Instead the request appends one row
-- here and returns. The runner picks it up, and a rule that fails leaves a row
-- with an error and no processed_at: visible, and replayable.
--
-- Reversibility:
--   ALTER TABLE coach_tasks DROP CONSTRAINT coach_tasks_template_fk;
--   DROP TABLE coach_automation_rules;
--   DROP TABLE coach_automation_events;
--   DROP TABLE coach_task_templates;

-- ---------------------------------------------------------------------------
-- 1. Templates: what a created task looks like
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coach_task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable slug the rules refer to, e.g. 'networking.create_campaign'.
  key TEXT NOT NULL UNIQUE,

  title       TEXT NOT NULL,
  description TEXT,

  -- Must be a coach profile. Same enforcement story as coach_tasks.assignee:
  -- the API refuses it, the nightly job asserts it.
  default_assignee_profile_id UUID REFERENCES client_profiles(id),

  -- "Due offset default +1 day, editable per template and per task." This is
  -- the per-template half. The per-task half is simply coach_tasks.due_at,
  -- which is why there is no second offset column here.
  due_offset_days INTEGER NOT NULL DEFAULT 1,

  -- For tasks completed with a decision rather than a plain tick. The review
  -- task carries ARRAY['approve','request_changes']; rules then match on which
  -- one was chosen. NULL means an ordinary task.
  decision_options TEXT[],

  -- The event that completes this task automatically, e.g.
  -- 'networking_plan.generated'. NULL means only a person can complete it.
  auto_complete_event TEXT,

  active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deferred from 20260926_coach_tasks.sql, which could not reference a table
-- that did not exist yet.
--
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, and everything else in these
-- three files is safe to re-run, so this is guarded by hand rather than left as
-- the one statement that fails on a second pass.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coach_tasks_template_fk'
  ) THEN
    ALTER TABLE coach_tasks
      ADD CONSTRAINT coach_tasks_template_fk
      FOREIGN KEY (template_id) REFERENCES coach_task_templates(id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Events: something happened
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coach_automation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 'client_profile.submitted', 'task.completed', 'networking_plan.shared'.
  event_key TEXT NOT NULL,

  -- Everything a rule needs to decide and to act: the task id and its template
  -- key for task events, the decision for a review, the client for a plan event.
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  client_profile_id UUID REFERENCES client_profiles(id),

  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Set once the runner has finished with it, INCLUDING when no rule matched
  -- and including when a matching rule deliberately did nothing. An unprocessed
  -- row is work outstanding; it is never the record of a no-op.
  processed_at TIMESTAMPTZ,

  -- What the runner did, for the auditable no-op path. 'no_match' when no open
  -- task existed to complete or reopen. See the note on that in the plan.
  outcome TEXT,

  error TEXT
);

-- The runner's queue.
CREATE INDEX IF NOT EXISTS coach_automation_events_pending_idx
  ON coach_automation_events (occurred_at)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS coach_automation_events_key_idx
  ON coach_automation_events (event_key, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Rules: when THIS happens, do THAT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coach_automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  event_key TEXT NOT NULL,

  action TEXT NOT NULL
    CHECK (action IN ('create_task','complete_task','reopen_task')),

  -- create_task: the template to create from.
  template_id UUID REFERENCES coach_task_templates(id),

  -- complete_task / reopen_task: which template's open task to act on. A key
  -- rather than an id so a rule reads as what it means.
  target_template_key TEXT,

  -- Matched against the event payload. {"template_key": "...", "decision":
  -- "approve"} is the whole of what the Networking chain needs. Empty object
  -- matches every event with this key.
  condition JSONB NOT NULL DEFAULT '{}'::jsonb,

  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- An action must name what it acts on, and the right one for its kind.
  CONSTRAINT coach_automation_rules_target_matches_action CHECK (
    (action = 'create_task' AND template_id IS NOT NULL)
    OR (action IN ('complete_task','reopen_task') AND target_template_key IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS coach_automation_rules_lookup_idx
  ON coach_automation_rules (event_key, sort_order)
  WHERE active;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- These three are operator configuration and an internal queue, not per-coach
-- data. Only the service role touches them, so RLS is on with no policy: that
-- denies every anon and authenticated request outright, rather than leaving the
-- tables readable by any logged-in user.
ALTER TABLE coach_task_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_automation_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_automation_rules   ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
