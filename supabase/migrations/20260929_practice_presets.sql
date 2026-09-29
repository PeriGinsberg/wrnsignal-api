-- A practice question can come from a preset.
--
-- Session 1's round is fixed: five questions, sent automatically the moment
-- the homework is marked complete, identical for every client. Nobody picked
-- them from the bank and nobody typed them, so neither existing source value
-- is true.
--
-- WHY THE VALUE MATTERS AT ALL. It is the only thing distinguishing an
-- automatic round from one a coach built, and the two are otherwise the same
-- rows on purpose. Without it, "how many rounds did coaches actually build"
-- stops being answerable the day this ships.
--
-- Reversibility:
--   UPDATE practice_questions SET source = 'custom' WHERE source = 'preset';
--   ALTER TABLE practice_questions DROP CONSTRAINT practice_questions_source_check;
--   ALTER TABLE practice_questions ADD CONSTRAINT practice_questions_source_check
--     CHECK (source IN ('bank', 'custom'));

ALTER TABLE public.practice_questions
  DROP CONSTRAINT IF EXISTS practice_questions_source_check;

ALTER TABLE public.practice_questions
  ADD CONSTRAINT practice_questions_source_check
  CHECK (source IN ('bank', 'custom', 'preset'));
