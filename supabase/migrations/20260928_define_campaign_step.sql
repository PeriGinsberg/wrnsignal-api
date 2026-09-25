-- ═══════════════════════════════════════════════════
-- "Define Networking Campaign", the step before the chain — 2026-09-28
-- ═══════════════════════════════════════════════════
--
-- IN PLAIN ENGLISH
--
-- The Networking chain started at "a brief was submitted". The step before that
-- was already happening and was already being written down by hand: someone
-- decides this client should have a campaign, and writes themselves a task
-- called "Define Networking Campaign". Submitting the brief is what finishes
-- that work, so the task should tick itself when the brief arrives.
--
-- Two columns, because the existing engine cannot express either half.
--
-- 1. assign_to_lead_coach
--
-- A template names ONE default assignee, which is right for "Erin builds every
-- campaign" and wrong for a task that belongs to whoever coaches this
-- particular client. With this set, the runner resolves the assignee from
-- coach_clients.coach_profile_id for the relationship the event carries, and
-- falls back to default_assignee_profile_id when there is no relationship or
-- the coach on it is not assignable. The default is never removed: it is the
-- fallback, not decoration.
--
-- 2. match_scope
--
-- complete_task and reopen_task find their target by walking chain_id, then
-- brief_id, then the client. That is deliberately strict: two clients running
-- the same campaign must not complete each other's tasks, and an old campaign's
-- share task must not be ticked by a new campaign's share.
--
-- "Define Networking Campaign" breaks that, and has to. It exists BEFORE any
-- campaign, so it carries no chain_id and no brief_id, while the event that
-- completes it carries both. Strict scoping would filter on brief_id and find
-- nothing. So this rule opts in to 'client': match on the client alone.
--
-- 'chain' stays the default, so every existing rule keeps its current
-- behaviour. Opting in is a decision a rule makes, not something it inherits.
--
-- Reversibility:
--   ALTER TABLE coach_task_templates DROP COLUMN assign_to_lead_coach;
--   UPDATE coach_task_templates SET due_offset_days = 1 WHERE due_offset_days IS NULL;
--   ALTER TABLE coach_task_templates ALTER COLUMN due_offset_days SET NOT NULL;
--   ALTER TABLE coach_automation_rules DROP COLUMN match_scope;
--   DELETE FROM coach_automation_rules WHERE target_template_key = 'networking.define_campaign';
--   DELETE FROM coach_task_templates WHERE key = 'networking.define_campaign';

ALTER TABLE public.coach_task_templates
  ADD COLUMN IF NOT EXISTS assign_to_lead_coach BOOLEAN NOT NULL DEFAULT false;

-- 3. A template with no natural deadline.
--
-- due_offset_days was NOT NULL DEFAULT 1, so every template had to name a day.
-- "Define Networking Campaign" has no deadline: deciding a client should run a
-- campaign is not late on any particular date, and a task that goes overdue on
-- its own trains the overdue digest to be ignored. NULL now means exactly that,
-- and the runner leaves due_at unset. Existing templates keep their values; the
-- default stays 1, so a template that says nothing still gets tomorrow.
ALTER TABLE public.coach_task_templates
  ALTER COLUMN due_offset_days DROP NOT NULL;

ALTER TABLE public.coach_automation_rules
  ADD COLUMN IF NOT EXISTS match_scope TEXT NOT NULL DEFAULT 'chain';

-- Guarded by hand: ADD CONSTRAINT has no IF NOT EXISTS, so a second run would
-- fail with 42710 rather than changing nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coach_automation_rules_match_scope_check'
  ) THEN
    ALTER TABLE public.coach_automation_rules
      ADD CONSTRAINT coach_automation_rules_match_scope_check
      CHECK (match_scope IN ('chain', 'client'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
