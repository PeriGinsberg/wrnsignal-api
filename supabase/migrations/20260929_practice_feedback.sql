-- Written coach feedback on a practice round.
--
-- COLUMNS, NOT A TABLE. Feedback is exactly one "what works" and one "what to
-- fix" per question, plus one overall note on the round. A feedback table
-- would be a join for something that is one-to-one with rows that already
-- exist, and every read of a round already reads both.
--
-- DRAFT UNTIL RELEASED. The coach types over several minutes and it autosaves,
-- so the columns fill long before the client should see any of it.
-- feedback_sent_at is the gate: null means the client is shown nothing, and
-- the client-facing API refuses to return these fields until it is set. That
-- is the same shape as workbook comments, which are written and then released.

ALTER TABLE public.practice_questions
  ADD COLUMN IF NOT EXISTS fb_works text,
  ADD COLUMN IF NOT EXISTS fb_fix   text;

ALTER TABLE public.practice_rounds
  ADD COLUMN IF NOT EXISTS fb_overall      text,
  ADD COLUMN IF NOT EXISTS feedback_sent_at timestamptz;

-- The round gains a fourth state. Ordering is the lifecycle:
-- draft -> sent -> submitted -> feedback_sent.
ALTER TABLE public.practice_rounds
  DROP CONSTRAINT IF EXISTS practice_rounds_status_check;

ALTER TABLE public.practice_rounds
  ADD CONSTRAINT practice_rounds_status_check
  CHECK (status IN ('draft', 'sent', 'submitted', 'feedback_sent'));

-- The client's "what have I got waiting" query: their rounds, newest first,
-- without scanning the coach's drafts.
CREATE INDEX IF NOT EXISTS practice_rounds_client_feedback_idx
  ON public.practice_rounds (client_profile_id, feedback_sent_at DESC)
  WHERE deleted_at IS NULL;
