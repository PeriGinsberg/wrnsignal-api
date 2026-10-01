-- A topic on a note: phase, deliverable or milestone. 2026-10-01.
--
-- IN PLAIN ENGLISH
--
-- A coach can file a note under one of three topics. Notes with a topic also
-- show on the record's tracker, grouped under that topic: under the stage
-- tracker on a prospect, on the Engagements tab on a client. A note with no
-- topic is an ordinary note, as every note written before today is.
--
-- The three values are fixed labels, not links to a particular stage or
-- deliverable.
--
-- Same day: Action Item stops being a note type anyone can choose. Work to do
-- is a task. Rows already typed action_item keep their type (the catch-up in
-- 20260930_action_item_note_catchup.sql gives each one a task), so the type's
-- CHECK is left as it is.
--
-- Additive and nullable: nothing reads it until the app does. Safe to run
-- twice.
--
-- Reversibility:
--   ALTER TABLE coach_client_notes DROP CONSTRAINT IF EXISTS coach_client_notes_topic_valid;
--   ALTER TABLE coach_client_notes DROP COLUMN IF EXISTS topic;

ALTER TABLE coach_client_notes
  ADD COLUMN IF NOT EXISTS topic TEXT;

ALTER TABLE coach_client_notes
  DROP CONSTRAINT IF EXISTS coach_client_notes_topic_valid;
ALTER TABLE coach_client_notes
  ADD CONSTRAINT coach_client_notes_topic_valid
  CHECK (topic IS NULL OR topic IN ('phase', 'deliverable', 'milestone'));

-- The tracker reads one relationship's topic notes.
CREATE INDEX IF NOT EXISTS idx_coach_client_notes_topic
  ON coach_client_notes (coach_client_id, topic)
  WHERE topic IS NOT NULL AND deleted_at IS NULL;
