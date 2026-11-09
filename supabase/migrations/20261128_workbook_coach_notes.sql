-- 20261128_workbook_coach_notes.sql
-- Coach Notes on every workbook section (Peri, 2026-11-09).
--
-- Several coaches can take notes on the same client session at once. Each note
-- is its own row (workbook, section, coach, text, timestamps), never one shared
-- text field, so two coaches typing at the same time cannot overwrite each
-- other.
--
-- WHO SEES WHAT
--   read           every coach with full access to the client (wb_is_coach_of,
--                  delegates included): all coaches' notes, NOT filtered to
--                  the logged-in coach.
--   add            a coach on the client, as themselves only.
--   edit, delete   the note's author only.
--   the client     nothing. Coach-only: no client policy, and the client-facing
--                  functions (workbook_for_client, workbook_client_list) never
--                  read this table.
--
-- LIVE: the table joins the supabase_realtime publication. Realtime applies the
-- SELECT policy per subscriber, so a coach receives inserts and edits only on
-- clients they can read. A delete event carries the row id only.
--
-- Additive: one new table. Safe to run twice.
--
-- Reversibility:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.workbook_coach_notes;
--   DROP TABLE IF EXISTS public.workbook_coach_notes;

BEGIN;

CREATE TABLE IF NOT EXISTS public.workbook_coach_notes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workbook_id      uuid NOT NULL REFERENCES public.workbooks(id) ON DELETE CASCADE,
  section_id       text NOT NULL,
  coach_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  body             text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workbook_coach_notes_body_length CHECK (char_length(body) <= 20000)
);

CREATE INDEX IF NOT EXISTS workbook_coach_notes_workbook_idx
  ON public.workbook_coach_notes (workbook_id, section_id, created_at);

CREATE OR REPLACE FUNCTION public.workbook_coach_notes_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  -- The author and the anchor never change after the note is created.
  NEW.coach_profile_id = OLD.coach_profile_id;
  NEW.workbook_id = OLD.workbook_id;
  NEW.section_id = OLD.section_id;
  NEW.created_at = OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workbook_coach_notes_touch ON public.workbook_coach_notes;
CREATE TRIGGER workbook_coach_notes_touch BEFORE UPDATE ON public.workbook_coach_notes
  FOR EACH ROW EXECUTE FUNCTION public.workbook_coach_notes_touch();

ALTER TABLE public.workbook_coach_notes ENABLE ROW LEVEL SECURITY;

-- Read: any coach on the client. Deliberately no author filter.
DROP POLICY IF EXISTS workbook_coach_notes_select ON public.workbook_coach_notes;
CREATE POLICY workbook_coach_notes_select ON public.workbook_coach_notes
  FOR SELECT USING (wb_is_coach_of(workbook_id));

DROP POLICY IF EXISTS workbook_coach_notes_insert ON public.workbook_coach_notes;
CREATE POLICY workbook_coach_notes_insert ON public.workbook_coach_notes
  FOR INSERT WITH CHECK (wb_is_coach_of(workbook_id) AND coach_profile_id = wb_my_profile_id());

DROP POLICY IF EXISTS workbook_coach_notes_update ON public.workbook_coach_notes;
CREATE POLICY workbook_coach_notes_update ON public.workbook_coach_notes
  FOR UPDATE USING (coach_profile_id = wb_my_profile_id() AND wb_is_coach_of(workbook_id))
  WITH CHECK (coach_profile_id = wb_my_profile_id() AND wb_is_coach_of(workbook_id));

DROP POLICY IF EXISTS workbook_coach_notes_delete ON public.workbook_coach_notes;
CREATE POLICY workbook_coach_notes_delete ON public.workbook_coach_notes
  FOR DELETE USING (coach_profile_id = wb_my_profile_id() AND wb_is_coach_of(workbook_id));

REVOKE ALL ON public.workbook_coach_notes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workbook_coach_notes TO authenticated;
GRANT ALL ON public.workbook_coach_notes TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workbook_coach_notes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workbook_coach_notes;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify (every row true):
-- SELECT 'table' AS check, to_regclass('public.workbook_coach_notes') IS NOT NULL AS ok
-- UNION ALL SELECT 'rls on', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.workbook_coach_notes'::regclass)
-- UNION ALL SELECT 'read has no author filter', (SELECT qual FROM pg_policies WHERE policyname = 'workbook_coach_notes_select') = 'wb_is_coach_of(workbook_id)'
-- UNION ALL SELECT 'edit/delete author only', (SELECT count(*) FROM pg_policies WHERE tablename = 'workbook_coach_notes' AND cmd IN ('UPDATE', 'DELETE') AND qual LIKE '%wb_my_profile_id()%') = 2
-- UNION ALL SELECT 'realtime', EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'workbook_coach_notes');
