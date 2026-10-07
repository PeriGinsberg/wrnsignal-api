-- Calendly session bookings on clients' plans. 2026-10-07.
--
-- IN PLAIN ENGLISH
--
-- 1. A Calendly event type can now mean "a coaching session was booked"
--    (action 'session_booked'), not only "a consult was booked". Each such
--    mapping names the library deliverable the session belongs to (milestone_id),
--    e.g. Resume Workshop. A mapping with no deliverable (the catch-all WRN
--    Working Session) always makes a one-off prep task on the coach's To-Do.
-- 2. Each booking SIGNAL acts on remembers the tasks it touched: the client's
--    Book task, the coach's Prepare task, or the one-off To-Do item. A
--    reschedule or cancellation later finds exactly those, not a guess.
--
-- Additive: a widened CHECK and new nullable columns. Safe to run twice.
--
-- Reversibility:
--   DELETE FROM calendly_event_type_actions WHERE action = 'session_booked';
--   ALTER TABLE calendly_event_type_actions DROP COLUMN IF EXISTS milestone_id;
--   ALTER TABLE calendly_webhook_deliveries DROP COLUMN IF EXISTS book_task_id,
--     DROP COLUMN IF EXISTS prep_task_id, DROP COLUMN IF EXISTS todo_task_id;
--   (then restore the action CHECK to ('consult_booked'))

-- ── 1. The 'session_booked' action, and the deliverable it points at ────────

-- The action CHECK was declared inline, so Postgres named it. Found by its
-- definition rather than trusted to a name.
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'calendly_event_type_actions'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%consult_booked%'
  LOOP
    EXECUTE format('ALTER TABLE calendly_event_type_actions DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE calendly_event_type_actions
  ADD CONSTRAINT calendly_event_type_actions_action_check
  CHECK (action IN ('consult_booked', 'session_booked'));

ALTER TABLE calendly_event_type_actions
  ADD COLUMN IF NOT EXISTS milestone_id UUID REFERENCES coach_milestones(id) ON DELETE SET NULL;

-- ── 2. What a booking touched ───────────────────────────────────────────────

ALTER TABLE calendly_webhook_deliveries
  ADD COLUMN IF NOT EXISTS book_task_id UUID REFERENCES coach_client_engagement_activities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prep_task_id UUID REFERENCES coach_client_engagement_activities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS todo_task_id UUID REFERENCES coach_tasks(id) ON DELETE SET NULL;
