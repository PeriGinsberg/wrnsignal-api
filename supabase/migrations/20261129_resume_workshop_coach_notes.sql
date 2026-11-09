-- 20261129_resume_workshop_coach_notes.sql
-- Coach Notes on every Resume Workshop tab (Peri, 2026-11-09).
--
-- Several coaches can take notes in the same live Resume Workshop at once.
-- Each note is its own row (relationship, tab, coach, text, timestamps), never
-- one shared text field, so simultaneous coaches cannot overwrite each other.
--
-- WHO SEES WHAT
--   read           every coach on the CLIENT: the workshop belongs to one
--                  coach_clients row, but a client with several coaches has
--                  one row per coach, so reads span every coach_clients row
--                  of the same client_profile_id (the Shape 1 re-scope), and
--                  delegates read through coach_acting_ids(). NO filter on
--                  the logged-in coach.
--   add            the relationship's coach or delegate, as themselves (API).
--   edit, delete   the note's author only (API, matched on coach_profile_id).
--   the client     nothing: coach-only, like the rest of the workshop.
--
-- Writes go through the API with the service role, like every other
-- resume_workshop_* table. The one RLS policy here is the SELECT that Supabase
-- realtime applies per subscriber, so a coach receives live inserts and edits
-- only for clients they coach. A delete event carries the row id only.
--
-- tab: the nine discovery tabs plus 'general' (General notes).
--
-- Additive: one new table and one helper. Safe to run twice.
--
-- Reversibility:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.resume_workshop_coach_notes;
--   DROP TABLE IF EXISTS public.resume_workshop_coach_notes;
--   DROP FUNCTION IF EXISTS public.rw_can_read_coach_notes(uuid);

BEGIN;

CREATE TABLE IF NOT EXISTS public.resume_workshop_coach_notes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_client_id  uuid NOT NULL REFERENCES public.coach_clients(id) ON DELETE CASCADE,
  tab              text NOT NULL CHECK (tab IN (
                     'education', 'coursework', 'honors', 'certifications', 'experience',
                     'projects', 'skills', 'leadership', 'other', 'general')),
  coach_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  body             text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resume_workshop_coach_notes_body_length CHECK (char_length(body) <= 20000)
);

CREATE INDEX IF NOT EXISTS resume_workshop_coach_notes_cc_idx
  ON public.resume_workshop_coach_notes (coach_client_id, tab, created_at);

CREATE OR REPLACE FUNCTION public.resume_workshop_coach_notes_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  -- The author and the anchor never change after the note is created.
  NEW.coach_profile_id = OLD.coach_profile_id;
  NEW.coach_client_id = OLD.coach_client_id;
  NEW.tab = OLD.tab;
  NEW.created_at = OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resume_workshop_coach_notes_touch ON public.resume_workshop_coach_notes;
CREATE TRIGGER resume_workshop_coach_notes_touch BEFORE UPDATE ON public.resume_workshop_coach_notes
  FOR EACH ROW EXECUTE FUNCTION public.resume_workshop_coach_notes_touch();

-- May the caller read notes written on this relationship? Yes when the caller
-- (or a coach they are an active delegate of) has an ACTIVE relationship with
-- the same client, or with this very relationship (a client with no profile).
CREATE OR REPLACE FUNCTION public.rw_can_read_coach_notes(p_coach_client uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM coach_clients note_cc
    JOIN coach_clients mine
      ON mine.id = note_cc.id
      OR (note_cc.client_profile_id IS NOT NULL AND mine.client_profile_id = note_cc.client_profile_id)
    WHERE note_cc.id = p_coach_client
      AND mine.coach_profile_id = ANY (coach_acting_ids())
      AND mine.status = 'active'
  )
$$;

REVOKE ALL ON FUNCTION public.rw_can_read_coach_notes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rw_can_read_coach_notes(uuid) TO authenticated, service_role;

ALTER TABLE public.resume_workshop_coach_notes ENABLE ROW LEVEL SECURITY;

-- Read only (realtime). No insert/update/delete policy: writes are the API's.
DROP POLICY IF EXISTS resume_workshop_coach_notes_select ON public.resume_workshop_coach_notes;
CREATE POLICY resume_workshop_coach_notes_select ON public.resume_workshop_coach_notes
  FOR SELECT TO authenticated USING (rw_can_read_coach_notes(coach_client_id));

REVOKE ALL ON public.resume_workshop_coach_notes FROM anon, authenticated;
GRANT SELECT ON public.resume_workshop_coach_notes TO authenticated;
GRANT ALL ON public.resume_workshop_coach_notes TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'resume_workshop_coach_notes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.resume_workshop_coach_notes;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify (every row true):
-- SELECT 'table' AS check, to_regclass('public.resume_workshop_coach_notes') IS NOT NULL AS ok
-- UNION ALL SELECT 'rls on', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.resume_workshop_coach_notes'::regclass)
-- UNION ALL SELECT 'read has no author filter', (SELECT qual FROM pg_policies WHERE policyname = 'resume_workshop_coach_notes_select') = 'rw_can_read_coach_notes(coach_client_id)'
-- UNION ALL SELECT 'no client write policies', (SELECT count(*) FROM pg_policies WHERE tablename = 'resume_workshop_coach_notes' AND cmd <> 'SELECT') = 0
-- UNION ALL SELECT 'realtime', EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'resume_workshop_coach_notes');
