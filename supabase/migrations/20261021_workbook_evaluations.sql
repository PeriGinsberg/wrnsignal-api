-- Workbook evaluations: the coach's saved rubric for a live case. 2026-10-18.
--
-- IN PLAIN ENGLISH
--
-- A workbook section can carry a coach guide with a rubric (for example six
-- case skills, each rated Independent / Prompted / Not demonstrated). The coach
-- rates the client during the live session and the ratings are saved here, one
-- row per workbook section:
--
--   ratings  { "<item key>": { "rating": "<scale key>" | null, "note": "..." } }
--   note     the coach's overall note (strength, priority, next practice)
--
-- COACH ONLY, exactly like workbook_section_marks: a coach-only policy and no
-- client policy, so a client can never read or write a row. The client-facing
-- functions (workbook_for_client, workbook_client_list) never touch this table.
-- The keys are the stable keys from the workbook content, so the Performance
-- Package can export them as structured data.
--
-- Additive: one new table. Safe to run twice.
--
-- Reversibility:
--   DROP TABLE IF EXISTS public.workbook_evaluations;

CREATE TABLE IF NOT EXISTS public.workbook_evaluations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workbook_id uuid NOT NULL REFERENCES public.workbooks(id) ON DELETE CASCADE,
  section_id  text NOT NULL,
  ratings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  note        text,
  updated_by  uuid NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workbook_id, section_id),
  CONSTRAINT workbook_evaluations_ratings_object CHECK (jsonb_typeof(ratings) = 'object')
);

ALTER TABLE public.workbook_evaluations ENABLE ROW LEVEL SECURITY;

-- Coach only. The client has no policy on this table.
DROP POLICY IF EXISTS workbook_evaluations_coach_all ON public.workbook_evaluations;
CREATE POLICY workbook_evaluations_coach_all ON public.workbook_evaluations
  FOR ALL USING (wb_is_coach_of(workbook_id))
  WITH CHECK (wb_is_coach_of(workbook_id) AND updated_by = wb_my_profile_id());

NOTIFY pgrst, 'reload schema';
