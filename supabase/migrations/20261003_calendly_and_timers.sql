-- Prospect workflow, Phase 3: Calendly, and time-based automation. 2026-10-03.
--
-- IN PLAIN ENGLISH
--
-- 1. Time-based rules. An automation rule can now say "when event A happens,
--    wait N days, then fire event B, unless event C happens first". The new
--    action is 'schedule'; the wait, the event it fires and the events that
--    cancel it are new columns on the rule. Each waiting timer is a row in
--    coach_automation_timers, fired by the half-hourly automation job.
-- 2. The first such rule: a booking-form submission starts a 3-day timer that
--    a booked consult (or the prospect being marked lost) cancels. If it fires,
--    "Follow up with [name]: no consult booked yet" is created for the
--    prospect's coach, due that day. The SOW day-3 and day-7 follow-ups will be
--    two more rows of the same shape.
-- 3. calendly_event_type_actions: which Calendly event type, for which coach,
--    means which SIGNAL action. One action exists today, consult_booked.
--    Another meeting type later is a new row (and a new action in the app if it
--    needs new behaviour).
-- 4. calendly_webhook_deliveries: every booking or cancellation Calendly sends,
--    once (Calendly retries, the unique key stops a second run), with what
--    SIGNAL did about it.
--
-- Additive: new columns with defaults, a widened CHECK, new tables, and seed
-- rows guarded against a second run. Safe to run twice.
--
-- Reversibility:
--   DELETE FROM coach_automation_rules WHERE event_key IN ('booking_form.submitted', 'booking_form.no_consult');
--   DELETE FROM coach_task_templates WHERE key = 'booking_followup_no_consult';
--   DROP TABLE IF EXISTS calendly_webhook_deliveries, calendly_event_type_actions, coach_automation_timers;
--   (then restore the two rule CHECKs below without 'schedule', and drop
--    delay_days, fires_event_key, cancel_on_event_keys)

-- ── 1. The 'schedule' rule action ───────────────────────────────────────────

ALTER TABLE coach_automation_rules
  ADD COLUMN IF NOT EXISTS delay_days INTEGER,
  ADD COLUMN IF NOT EXISTS fires_event_key TEXT,
  ADD COLUMN IF NOT EXISTS cancel_on_event_keys TEXT[] NOT NULL DEFAULT '{}';

-- The action CHECK was declared inline, so Postgres named it. Found by its
-- definition rather than trusted to a name.
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'coach_automation_rules'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%create_task%'
      AND conname <> 'coach_automation_rules_target_matches_action'
  LOOP
    EXECUTE format('ALTER TABLE coach_automation_rules DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE coach_automation_rules
  ADD CONSTRAINT coach_automation_rules_action_check
  CHECK (action IN ('create_task', 'complete_task', 'reopen_task', 'schedule'));

ALTER TABLE coach_automation_rules DROP CONSTRAINT IF EXISTS coach_automation_rules_target_matches_action;
ALTER TABLE coach_automation_rules
  ADD CONSTRAINT coach_automation_rules_target_matches_action CHECK (
    (action = 'create_task' AND template_id IS NOT NULL)
    OR (action IN ('complete_task', 'reopen_task') AND target_template_key IS NOT NULL)
    OR (action = 'schedule' AND delay_days IS NOT NULL AND delay_days >= 0 AND fires_event_key IS NOT NULL)
  );

-- ── 2. Waiting timers ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS coach_automation_timers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES coach_automation_rules(id) ON DELETE SET NULL,
  source_event_id UUID REFERENCES coach_automation_events(id) ON DELETE SET NULL,
  fires_event_key TEXT NOT NULL,
  fire_at TIMESTAMPTZ NOT NULL,
  cancel_on_event_keys TEXT[] NOT NULL DEFAULT '{}',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_profile_id UUID REFERENCES client_profiles(id) ON DELETE CASCADE,
  -- A prospect deleted while its timer waits takes the timer with it.
  coach_client_id UUID REFERENCES coach_clients(id) ON DELETE CASCADE,
  fired_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by_event_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coach_automation_timers_due_idx
  ON coach_automation_timers (fire_at)
  WHERE fired_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS coach_automation_timers_coach_client_idx
  ON coach_automation_timers (coach_client_id)
  WHERE fired_at IS NULL AND cancelled_at IS NULL;

-- ── 3. The no-booking follow-up ─────────────────────────────────────────────

INSERT INTO coach_task_templates
  (key, title, description, default_assignee_profile_id, due_offset_days, assign_to_lead_coach, link_template)
VALUES (
  'booking_followup_no_consult',
  'Follow up with {name}: no consult booked yet',
  'They filled in the booking form three days ago and have not booked a time.',
  NULL, 0, TRUE, '/dashboard/coach/prospects/{coachClientId}'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO coach_automation_rules (event_key, action, delay_days, fires_event_key, cancel_on_event_keys, sort_order)
SELECT 'booking_form.submitted', 'schedule', 3, 'booking_form.no_consult', ARRAY['consult.booked', 'prospect.lost'], 0
WHERE NOT EXISTS (
  SELECT 1 FROM coach_automation_rules WHERE event_key = 'booking_form.submitted' AND action = 'schedule'
);

INSERT INTO coach_automation_rules (event_key, action, template_id, sort_order)
SELECT 'booking_form.no_consult', 'create_task', t.id, 0
FROM coach_task_templates t
WHERE t.key = 'booking_followup_no_consult'
  AND NOT EXISTS (
    SELECT 1 FROM coach_automation_rules WHERE event_key = 'booking_form.no_consult' AND action = 'create_task'
  );

-- ── 4. Calendly ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calendly_event_type_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_profile_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  -- The event type's API address, which is what a webhook carries.
  event_type_uri TEXT NOT NULL UNIQUE,
  event_type_name TEXT,
  -- The booking link the coach knows it by, for people reading this table.
  scheduling_url TEXT,
  action TEXT NOT NULL CHECK (action IN ('consult_booked')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendly_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event TEXT NOT NULL,
  invitee_uri TEXT NOT NULL,
  scheduled_event_uri TEXT,
  event_type_uri TEXT,
  invitee_email TEXT,
  coach_client_id UUID REFERENCES coach_clients(id) ON DELETE SET NULL,
  outcome TEXT,
  detail TEXT,
  payload JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event, invitee_uri)
);

CREATE INDEX IF NOT EXISTS calendly_webhook_deliveries_invitee_idx
  ON calendly_webhook_deliveries (invitee_uri);

ALTER TABLE coach_automation_timers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendly_event_type_actions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendly_webhook_deliveries  ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
