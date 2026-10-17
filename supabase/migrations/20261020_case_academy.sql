-- Casing Academy: a practice round can be a fixed-sequence case. 2026-10-17.
--
-- IN PLAIN ENGLISH
--
-- A case round is an ordinary practice round (same rows, same recording,
-- same submit, same coach feedback and release) with a few things added:
--
--   practice_rounds
--     kind             'interview' (every round so far) or 'case'.
--     case_id          which case in the library (lib/academy/cases), e.g.
--                      'meridian-card-baseline'. The coach's answer key and
--                      guide live in code, keyed by this, and are only ever
--                      served by coach routes.
--     workbook_id      the workbook the round belongs to, so the coach sees
--                      both and one export carries both.
--     scenario         the case set-up the student reads before question 1.
--     self_assessment  the student's five answers after the case.
--     rubric           COACH ONLY. Score 1-5 and a note per dimension.
--     coach_review     COACH ONLY. Strengths, priorities, drills, summary.
--
--   practice_questions
--     qkey, title, exhibit   the case's question id, short title and any
--                            numbers shown with it.
--     answer_seconds         this question's limit; null means the usual 90.
--     prep_seconds           think time before recording starts; null is none.
--
--   practice_takes
--     audio_path             a separate audio-only file, for the transcript.
--     question_shown_at, response_started_at, response_ended_at
--                            when the question appeared, and when recording
--                            started and stopped (the student's clock).
--     first_speech_ms        ms into the recording before the first words,
--                            from the transcript's first segment.
--     transcript*            the verbatim transcript and its state.
--
-- Additive: new nullable columns and one defaulted column. Existing rounds
-- read as kind 'interview' and behave exactly as before. Safe to run twice.
--
-- Reversibility:
--   ALTER TABLE practice_takes DROP COLUMN IF EXISTS audio_path, DROP COLUMN IF EXISTS question_shown_at,
--     DROP COLUMN IF EXISTS response_started_at, DROP COLUMN IF EXISTS response_ended_at,
--     DROP COLUMN IF EXISTS first_speech_ms, DROP COLUMN IF EXISTS transcript,
--     DROP COLUMN IF EXISTS transcript_status, DROP COLUMN IF EXISTS transcript_error,
--     DROP COLUMN IF EXISTS transcript_segments, DROP COLUMN IF EXISTS transcribed_at;
--   ALTER TABLE practice_questions DROP COLUMN IF EXISTS qkey, DROP COLUMN IF EXISTS title,
--     DROP COLUMN IF EXISTS exhibit, DROP COLUMN IF EXISTS answer_seconds, DROP COLUMN IF EXISTS prep_seconds;
--   ALTER TABLE practice_rounds DROP COLUMN IF EXISTS kind, DROP COLUMN IF EXISTS case_id,
--     DROP COLUMN IF EXISTS workbook_id, DROP COLUMN IF EXISTS scenario,
--     DROP COLUMN IF EXISTS self_assessment, DROP COLUMN IF EXISTS self_assessed_at,
--     DROP COLUMN IF EXISTS rubric, DROP COLUMN IF EXISTS coach_review, DROP COLUMN IF EXISTS review_updated_at;

ALTER TABLE public.practice_rounds
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'interview',
  ADD COLUMN IF NOT EXISTS case_id text,
  ADD COLUMN IF NOT EXISTS workbook_id uuid REFERENCES public.workbooks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scenario text,
  ADD COLUMN IF NOT EXISTS self_assessment jsonb,
  ADD COLUMN IF NOT EXISTS self_assessed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rubric jsonb,
  ADD COLUMN IF NOT EXISTS coach_review jsonb,
  ADD COLUMN IF NOT EXISTS review_updated_at timestamptz;

ALTER TABLE public.practice_rounds DROP CONSTRAINT IF EXISTS practice_rounds_kind_check;
ALTER TABLE public.practice_rounds
  ADD CONSTRAINT practice_rounds_kind_check CHECK (kind IN ('interview', 'case'));

CREATE INDEX IF NOT EXISTS practice_rounds_workbook_idx
  ON public.practice_rounds (workbook_id) WHERE workbook_id IS NOT NULL;

ALTER TABLE public.practice_questions
  ADD COLUMN IF NOT EXISTS qkey text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS exhibit text,
  ADD COLUMN IF NOT EXISTS answer_seconds integer,
  ADD COLUMN IF NOT EXISTS prep_seconds integer;

ALTER TABLE public.practice_questions DROP CONSTRAINT IF EXISTS practice_questions_seconds_check;
ALTER TABLE public.practice_questions
  ADD CONSTRAINT practice_questions_seconds_check CHECK (
    (answer_seconds IS NULL OR answer_seconds BETWEEN 10 AND 900)
    AND (prep_seconds IS NULL OR prep_seconds BETWEEN 0 AND 600)
  );

ALTER TABLE public.practice_takes
  ADD COLUMN IF NOT EXISTS audio_path text,
  ADD COLUMN IF NOT EXISTS question_shown_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_speech_ms integer,
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS transcript_status text,
  ADD COLUMN IF NOT EXISTS transcript_error text,
  ADD COLUMN IF NOT EXISTS transcript_segments jsonb,
  ADD COLUMN IF NOT EXISTS transcribed_at timestamptz;

ALTER TABLE public.practice_takes DROP CONSTRAINT IF EXISTS practice_takes_transcript_status_check;
ALTER TABLE public.practice_takes
  ADD CONSTRAINT practice_takes_transcript_status_check CHECK (
    transcript_status IS NULL OR transcript_status IN ('pending', 'done', 'failed', 'unavailable')
  );

NOTIFY pgrst, 'reload schema';
