-- 20260727_network_note_action_type.sql
-- ADDITIVE: add 'note' to network_actions.type.
--
-- WHY A NEW TYPE RATHER THAN A REQUEST FLAG
-- 'note_logged' is doing double duty today. vocab.ts maps four DUE REASONS onto
-- it — reply, nurture_recurring, ask_followup, manual — so the worklist's
-- "Log it" and the spreadsheet's inline Log button both write 'note_logged'
-- when satisfying a due touch that has no more specific type. Those MUST count
-- as pipeline activity: they are how the user says "I did the thing."
--
-- A standalone note is the opposite: it must NOT consume reminder_override, must
-- NOT move last_action_at, and must NOT recompute next_due_at. Making
-- 'note_logged' inert would leave every reply / check-in / manual reminder
-- permanently overdue.
--
-- So the two meanings get two types. The distinction is semantic and permanent,
-- and it belongs in the schema where the DB can enforce it — not in a request
-- flag that leaves already-written rows ambiguous forever.
--
--   'note'         standalone note. Inert. Timeline entry only.
--   'note_logged'  UNCHANGED. Pipeline activity, exactly as before.
--
-- No data migration: no existing row changes type, and nothing is backfilled.
-- Existing 'note_logged' rows keep their current meaning and behaviour.
--
-- The CHECK is inline in 20260723_network_tracker_v3_reconcile.sql, so Postgres
-- auto-named it network_actions_type_check. Dropped and re-added because a CHECK
-- cannot be altered in place.

ALTER TABLE public.network_actions
  DROP CONSTRAINT IF EXISTS network_actions_type_check;

ALTER TABLE public.network_actions
  ADD CONSTRAINT network_actions_type_check CHECK (type IN (
    'touch_1','touch_2','touch_3','intro_request','thank_you',
    'connection_request','engage_on_post','chat_scheduled','chat_done',
    'ask','note_logged','note','other'));

-- PostgREST caches the schema; without this the new value is rejected at the
-- API layer even though the constraint accepts it.
NOTIFY pgrst, 'reload schema';
