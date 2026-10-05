-- Sending a client's SOW. 2026-10-11.
--
-- IN PLAIN ENGLISH
--
-- 1. client_sows records each send: who it went to, the cc (a parent), how
--    many times it has been sent, and Postmark's message id. (The frozen copy,
--    the link's hash and the send time are already there from 20261009.)
-- 2. The 3-day follow-up. When a SOW is sent (event sow.sent), a timer waits
--    three days and then (event sow.no_response) creates a coach task:
--    "Follow up with {name}: SOW not accepted yet". Nothing goes to the
--    prospect. Let's Go (sow.accepted), marking the prospect lost
--    (prospect.lost), or sending the SOW again (sow.sent, which starts a
--    fresh three days) cancels the waiting timer. Same shape as the booking
--    form's follow-up in 20261003_calendly_and_timers.sql.
--
-- Additive: new nullable columns, one task template, two rules. Safe to run twice.
--
-- Reversibility:
--   DELETE FROM coach_automation_rules WHERE event_key IN ('sow.sent', 'sow.no_response');
--   DELETE FROM coach_task_templates WHERE key = 'sow_followup_no_response';
--   ALTER TABLE client_sows DROP COLUMN IF EXISTS sent_to, DROP COLUMN IF EXISTS sent_cc,
--     DROP COLUMN IF EXISTS send_count, DROP COLUMN IF EXISTS sent_message_id;

ALTER TABLE client_sows
  ADD COLUMN IF NOT EXISTS sent_to         TEXT,
  ADD COLUMN IF NOT EXISTS sent_cc         TEXT,
  ADD COLUMN IF NOT EXISTS send_count      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_message_id TEXT;

INSERT INTO coach_task_templates
  (key, title, description, default_assignee_profile_id, due_offset_days, assign_to_lead_coach, link_template)
VALUES (
  'sow_followup_no_response',
  'Follow up with {name}: SOW not accepted yet',
  'You sent their Statement of Work three days ago and they have not clicked Let''s Go.',
  NULL, 0, TRUE, '/dashboard/coach/prospects/{coachClientId}'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO coach_automation_rules (event_key, action, delay_days, fires_event_key, cancel_on_event_keys, sort_order)
SELECT 'sow.sent', 'schedule', 3, 'sow.no_response', ARRAY['sow.accepted', 'prospect.lost', 'sow.sent'], 0
WHERE NOT EXISTS (
  SELECT 1 FROM coach_automation_rules WHERE event_key = 'sow.sent' AND action = 'schedule'
);

INSERT INTO coach_automation_rules (event_key, action, template_id, sort_order)
SELECT 'sow.no_response', 'create_task', t.id, 0
FROM coach_task_templates t
WHERE t.key = 'sow_followup_no_response'
  AND NOT EXISTS (
    SELECT 1 FROM coach_automation_rules WHERE event_key = 'sow.no_response' AND action = 'create_task'
  );

NOTIFY pgrst, 'reload schema';
