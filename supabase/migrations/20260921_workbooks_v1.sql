-- 20260921_workbooks_v1.sql
-- Interview Workbooks v1 (docs/workbooks-v1/workbooks-v1/WORKBOOK_V1_SPEC.md).
--
-- A coach gives a client a workbook built from a JSON content file. The client
-- fills it in and sends it to the coach; the coach comments, suggests, answers
-- questions and sends it back.
--
-- UNLIKE EVERY OTHER COACH TABLE, RLS IS THE GUARD HERE. The workbook routes use
-- a caller-JWT Supabase client, not the service role, so these policies are what
-- actually runs. Two consequences shape the file:
--
-- 1. The client can reach Supabase REST directly with their own JWT and the
--    public anon key, so "the route filters coach_only" is not enough. The client
--    has NO policy on `workbooks` at all. Content reaches them only through
--    workbook_for_client(), which strips coach_only blocks in the database.
--
-- 2. Anything that writes across the two sides (a send releases one side's
--    drafts AND creates the other side's queue item) is a SECURITY DEFINER
--    function that checks the caller itself. One transaction per action.
--
-- Additive only. The one change to an existing table is coach_client_notes.link_tab.

-- ---------------------------------------------------------------------------
-- Who is calling
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wb_my_profile_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM client_profiles WHERE user_id = auth.uid() LIMIT 1
$$;

-- Full access only (spec decision 4). view/annotate coaches get nothing here.
CREATE OR REPLACE FUNCTION public.wb_is_full_coach(p_client uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM coach_clients cc
    WHERE cc.client_profile_id = p_client
      AND cc.coach_profile_id = wb_my_profile_id()
      AND cc.status = 'active'
      AND cc.access_level = 'full'
  )
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.workbooks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_client_id     uuid NOT NULL REFERENCES public.coach_clients(id) ON DELETE CASCADE,
  client_profile_id   uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  signal_interview_id uuid REFERENCES public.signal_interviews(id) ON DELETE SET NULL,
  slug                text NOT NULL,
  -- The whole content file, frozen for this workbook. A new content file is a
  -- new workbook, never an edit to this column.
  content             jsonb NOT NULL,
  status              text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'with_client', 'with_coach')),
  created_by          uuid REFERENCES public.client_profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_profile_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_workbooks_client ON public.workbooks (client_profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.workbook_answers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workbook_id     uuid NOT NULL REFERENCES public.workbooks(id) ON DELETE CASCADE,
  field_key       text NOT NULL,
  -- jsonb so a pick can hold {choice, other}; a text field holds a string.
  value           jsonb NOT NULL,
  updated_by_role text NOT NULL CHECK (updated_by_role IN ('client', 'coach')),
  updated_by_id   uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Set by trigger, never by the caller. The autosave clash check compares
  -- against the value the database wrote, not a client clock.
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workbook_id, field_key)
);

CREATE TABLE IF NOT EXISTS public.workbook_answer_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workbook_id     uuid NOT NULL REFERENCES public.workbooks(id) ON DELETE CASCADE,
  field_key       text NOT NULL,
  old_value       jsonb,
  new_value       jsonb NOT NULL,
  changed_by_role text NOT NULL,
  changed_by_id   uuid NOT NULL,
  source          text NOT NULL DEFAULT 'typed' CHECK (source IN ('typed', 'accepted_suggestion')),
  changed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workbook_answer_history_field
  ON public.workbook_answer_history (workbook_id, field_key, changed_at DESC);

CREATE TABLE IF NOT EXISTS public.workbook_comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workbook_id       uuid NOT NULL REFERENCES public.workbooks(id) ON DELETE CASCADE,
  -- Anchor. section_id '_general' is the one general question box.
  section_id        text NOT NULL,
  field_key         text,
  kind              text NOT NULL
    CHECK (kind IN ('coach_comment', 'coach_suggestion', 'client_question', 'coach_answer')),
  parent_id         uuid REFERENCES public.workbook_comments(id) ON DELETE CASCADE,
  body              text NOT NULL DEFAULT '',
  suggested_value   jsonb,
  suggestion_status text
    CHECK (suggestion_status IS NULL OR suggestion_status IN ('pending', 'accepted', 'kept_own')),
  author_role       text NOT NULL CHECK (author_role IN ('client', 'coach')),
  author_id         uuid NOT NULL,
  -- NULL = draft, invisible to the other side. Set only by the send functions.
  released_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workbook_comments_kind_author
    CHECK ((kind = 'client_question') = (author_role = 'client')),
  CONSTRAINT workbook_comments_suggestion_shape
    CHECK ((kind = 'coach_suggestion') = (suggested_value IS NOT NULL AND field_key IS NOT NULL AND suggestion_status IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_workbook_comments_workbook ON public.workbook_comments (workbook_id, created_at);

CREATE TABLE IF NOT EXISTS public.workbook_sends (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workbook_id   uuid NOT NULL REFERENCES public.workbooks(id) ON DELETE CASCADE,
  direction     text NOT NULL CHECK (direction IN ('to_coach', 'to_client')),
  sent_by       uuid NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  -- to_coach: unanswered client questions at send time. to_client: items released.
  item_count    integer NOT NULL DEFAULT 0,
  -- to_coach only: the Required Actions row this send created or refreshed.
  coach_note_id uuid REFERENCES public.coach_client_notes(id) ON DELETE SET NULL,
  -- to_client only: when the client first opened the workbook after this send.
  -- Clears the Coaches Hub item.
  opened_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_workbook_sends_workbook ON public.workbook_sends (workbook_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS public.workbook_section_marks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workbook_id uuid NOT NULL REFERENCES public.workbooks(id) ON DELETE CASCADE,
  section_id  text NOT NULL,
  marked_by   uuid NOT NULL,
  marked_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workbook_id, section_id)
);

-- Required Actions rows are opened on the client page; this names the tab.
ALTER TABLE public.coach_client_notes ADD COLUMN IF NOT EXISTS link_tab text;

-- ---------------------------------------------------------------------------
-- Row helpers (definer, because the client has no policy on workbooks)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wb_is_client_of(p_workbook uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM workbooks w
    WHERE w.id = p_workbook
      AND w.client_profile_id = wb_my_profile_id()
      AND w.status <> 'draft'
  )
$$;

CREATE OR REPLACE FUNCTION public.wb_is_coach_of(p_workbook uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM workbooks w
    WHERE w.id = p_workbook AND wb_is_full_coach(w.client_profile_id)
  )
$$;

-- coach_only blocks removed, section order and block order kept.
CREATE OR REPLACE FUNCTION public.wb_strip_coach_only(p_content jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_set(
    p_content,
    '{sections}',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_set(s, '{blocks}', COALESCE((
          SELECT jsonb_agg(b ORDER BY bo)
          FROM jsonb_array_elements(s->'blocks') WITH ORDINALITY AS bx(b, bo)
          WHERE b->>'type' IS DISTINCT FROM 'coach_only'
        ), '[]'::jsonb))
        ORDER BY so)
      FROM jsonb_array_elements(p_content->'sections') WITH ORDINALITY AS sx(s, so)
    ), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wb_answers_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_workbook_answers_touch ON public.workbook_answers;
CREATE TRIGGER trg_workbook_answers_touch
  BEFORE INSERT OR UPDATE ON public.workbook_answers
  FOR EACH ROW EXECUTE FUNCTION public.wb_answers_touch();

-- History is written here so no route can skip it. Definer because history has
-- no insert policy: nobody writes it directly.
CREATE OR REPLACE FUNCTION public.wb_answers_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_source text := COALESCE(NULLIF(current_setting('workbook.answer_source', true), ''), 'typed');
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.value IS NOT DISTINCT FROM NEW.value THEN
    RETURN NEW;
  END IF;
  INSERT INTO workbook_answer_history
    (workbook_id, field_key, old_value, new_value, changed_by_role, changed_by_id, source)
  VALUES
    (NEW.workbook_id, NEW.field_key,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.value END,
     NEW.value, NEW.updated_by_role, NEW.updated_by_id, v_source);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_workbook_answers_history ON public.workbook_answers;
CREATE TRIGGER trg_workbook_answers_history
  AFTER INSERT OR UPDATE ON public.workbook_answers
  FOR EACH ROW EXECUTE FUNCTION public.wb_answers_history();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.workbooks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workbook_answers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workbook_answer_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workbook_comments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workbook_sends          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workbook_section_marks  ENABLE ROW LEVEL SECURITY;

-- workbooks: coach reads. Creation is the operator script (service role);
-- status changes only through the send functions. The client has no policy.
DROP POLICY IF EXISTS workbooks_coach_select ON public.workbooks;
CREATE POLICY workbooks_coach_select ON public.workbooks
  FOR SELECT USING (wb_is_full_coach(client_profile_id));

-- answers: the client writes, both sides read. Coaches never write answers.
DROP POLICY IF EXISTS workbook_answers_select ON public.workbook_answers;
CREATE POLICY workbook_answers_select ON public.workbook_answers
  FOR SELECT USING (wb_is_client_of(workbook_id) OR wb_is_coach_of(workbook_id));

DROP POLICY IF EXISTS workbook_answers_client_insert ON public.workbook_answers;
CREATE POLICY workbook_answers_client_insert ON public.workbook_answers
  FOR INSERT WITH CHECK (
    wb_is_client_of(workbook_id)
    AND updated_by_role = 'client' AND updated_by_id = wb_my_profile_id()
  );

DROP POLICY IF EXISTS workbook_answers_client_update ON public.workbook_answers;
CREATE POLICY workbook_answers_client_update ON public.workbook_answers
  FOR UPDATE USING (wb_is_client_of(workbook_id))
  WITH CHECK (
    wb_is_client_of(workbook_id)
    AND updated_by_role = 'client' AND updated_by_id = wb_my_profile_id()
  );

-- history: read-only for both sides. Written by trigger only.
DROP POLICY IF EXISTS workbook_answer_history_select ON public.workbook_answer_history;
CREATE POLICY workbook_answer_history_select ON public.workbook_answer_history
  FOR SELECT USING (wb_is_client_of(workbook_id) OR wb_is_coach_of(workbook_id));

-- comments: each side sees its own drafts plus everything released.
DROP POLICY IF EXISTS workbook_comments_client_select ON public.workbook_comments;
CREATE POLICY workbook_comments_client_select ON public.workbook_comments
  FOR SELECT USING (
    wb_is_client_of(workbook_id) AND (author_role = 'client' OR released_at IS NOT NULL)
  );

DROP POLICY IF EXISTS workbook_comments_coach_select ON public.workbook_comments;
CREATE POLICY workbook_comments_coach_select ON public.workbook_comments
  FOR SELECT USING (
    wb_is_coach_of(workbook_id) AND (author_role = 'coach' OR released_at IS NOT NULL)
  );

DROP POLICY IF EXISTS workbook_comments_client_insert ON public.workbook_comments;
CREATE POLICY workbook_comments_client_insert ON public.workbook_comments
  FOR INSERT WITH CHECK (
    wb_is_client_of(workbook_id)
    AND kind = 'client_question' AND author_role = 'client'
    AND author_id = wb_my_profile_id() AND released_at IS NULL
  );

DROP POLICY IF EXISTS workbook_comments_coach_insert ON public.workbook_comments;
CREATE POLICY workbook_comments_coach_insert ON public.workbook_comments
  FOR INSERT WITH CHECK (
    wb_is_coach_of(workbook_id)
    AND kind IN ('coach_comment', 'coach_suggestion', 'coach_answer') AND author_role = 'coach'
    AND author_id = wb_my_profile_id() AND released_at IS NULL
  );

-- Drafts only, and only the author's own. released_at cannot be set here.
DROP POLICY IF EXISTS workbook_comments_draft_update ON public.workbook_comments;
CREATE POLICY workbook_comments_draft_update ON public.workbook_comments
  FOR UPDATE
  USING (author_id = wb_my_profile_id() AND released_at IS NULL
         AND (wb_is_client_of(workbook_id) OR wb_is_coach_of(workbook_id)))
  WITH CHECK (author_id = wb_my_profile_id() AND released_at IS NULL);

DROP POLICY IF EXISTS workbook_comments_draft_delete ON public.workbook_comments;
CREATE POLICY workbook_comments_draft_delete ON public.workbook_comments
  FOR DELETE
  USING (author_id = wb_my_profile_id() AND released_at IS NULL
         AND (wb_is_client_of(workbook_id) OR wb_is_coach_of(workbook_id)));

-- sends: read by both sides. Written only by the send functions.
DROP POLICY IF EXISTS workbook_sends_select ON public.workbook_sends;
CREATE POLICY workbook_sends_select ON public.workbook_sends
  FOR SELECT USING (wb_is_client_of(workbook_id) OR wb_is_coach_of(workbook_id));

-- section marks: coach only, notifies nobody.
DROP POLICY IF EXISTS workbook_section_marks_coach_all ON public.workbook_section_marks;
CREATE POLICY workbook_section_marks_coach_all ON public.workbook_section_marks
  FOR ALL USING (wb_is_coach_of(workbook_id))
  WITH CHECK (wb_is_coach_of(workbook_id) AND marked_by = wb_my_profile_id());

-- ---------------------------------------------------------------------------
-- Client reads (the only way content reaches a client)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.workbook_client_list()
RETURNS TABLE (
  id uuid, slug text, status text, updated_at timestamptz,
  company text, role text, interview_date date, coach_first_name text,
  sends_to_client integer, last_to_client_at timestamptz, last_to_client_opened_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.slug, w.status, w.updated_at,
         COALESCE(NULLIF(si.company_name, ''), w.content->'interview'->>'company'),
         COALESCE(NULLIF(si.job_title, ''), w.content->'interview'->>'role'),
         COALESCE(si.interview_date, (w.content->'interview'->>'date')::date),
         w.content->'coach'->>'first_name',
         (SELECT count(*)::int FROM workbook_sends s WHERE s.workbook_id = w.id AND s.direction = 'to_client'),
         ls.sent_at, ls.opened_at
  FROM workbooks w
  LEFT JOIN signal_interviews si ON si.id = w.signal_interview_id
  LEFT JOIN LATERAL (
    SELECT s.sent_at, s.opened_at FROM workbook_sends s
    WHERE s.workbook_id = w.id AND s.direction = 'to_client'
    ORDER BY s.sent_at DESC LIMIT 1
  ) ls ON true
  WHERE w.client_profile_id = wb_my_profile_id() AND w.status <> 'draft'
  ORDER BY w.updated_at DESC
$$;

CREATE OR REPLACE FUNCTION public.workbook_for_client(p_workbook uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', w.id,
    'slug', w.slug,
    'status', w.status,
    'updated_at', w.updated_at,
    'content', wb_strip_coach_only(w.content),
    'interview', CASE WHEN si.id IS NULL THEN NULL ELSE jsonb_build_object(
      'company_name', si.company_name,
      'job_title', si.job_title,
      'interview_date', si.interview_date,
      'interview_at', si.interview_at,
      'interviewer_names', si.interviewer_names
    ) END
  )
  FROM workbooks w
  LEFT JOIN signal_interviews si ON si.id = w.signal_interview_id
  WHERE w.id = p_workbook
    AND w.client_profile_id = wb_my_profile_id()
    AND w.status <> 'draft'
$$;

-- ---------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------

-- Client: Send to your coach. Releases the client's question drafts, creates
-- or refreshes ONE open Required Actions row for this workbook.
CREATE OR REPLACE FUNCTION public.workbook_send_to_coach(p_workbook uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me      uuid := wb_my_profile_id();
  w         workbooks%ROWTYPE;
  v_coach   uuid;
  v_first   text;
  v_open    integer;
  v_body    text;
  v_note    uuid;
  v_send    uuid;
BEGIN
  SELECT * INTO w FROM workbooks WHERE id = p_workbook FOR UPDATE;
  IF NOT FOUND OR v_me IS NULL OR w.client_profile_id <> v_me OR w.status = 'draft' THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE workbook_comments SET released_at = now(), updated_at = now()
  WHERE workbook_id = w.id AND author_role = 'client' AND released_at IS NULL;

  -- Questions still waiting on a released coach answer, including earlier ones.
  SELECT count(*)::int INTO v_open
  FROM workbook_comments q
  WHERE q.workbook_id = w.id AND q.kind = 'client_question' AND q.released_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM workbook_comments a
      WHERE a.parent_id = q.id AND a.kind = 'coach_answer' AND a.released_at IS NOT NULL
    );

  UPDATE workbooks SET status = 'with_coach', updated_at = now() WHERE id = w.id;

  SELECT COALESCE(NULLIF(w.content->'client'->>'first_name', ''),
                  NULLIF(split_part(cp.name, ' ', 1), ''), 'Your client')
    INTO v_first FROM client_profiles cp WHERE cp.id = w.client_profile_id;

  v_body := v_first || ' sent their workbook for review'
    || CASE WHEN v_open = 1 THEN ' (1 question)'
            WHEN v_open > 1 THEN ' (' || v_open || ' questions)'
            ELSE '' END;

  -- One open item per workbook: refresh it if the coach has not cleared it yet.
  SELECT n.id INTO v_note
  FROM workbook_sends s JOIN coach_client_notes n ON n.id = s.coach_note_id
  WHERE s.workbook_id = w.id AND s.direction = 'to_coach'
    AND n.completed_at IS NULL AND n.deleted_at IS NULL
  ORDER BY s.sent_at DESC LIMIT 1;

  IF v_note IS NOT NULL THEN
    UPDATE coach_client_notes SET body = v_body, updated_at = now() WHERE id = v_note;
  ELSE
    SELECT COALESCE(w.created_by, cc.coach_profile_id) INTO v_coach
    FROM coach_clients cc WHERE cc.id = w.coach_client_id;

    INSERT INTO coach_client_notes
      (coach_client_id, coach_profile_id, client_profile_id, type, priority, body, link_tab)
    VALUES
      (w.coach_client_id, v_coach, w.client_profile_id, 'action_item', 'this_week', v_body, 'workbooks')
    RETURNING id INTO v_note;
  END IF;

  INSERT INTO workbook_sends (workbook_id, direction, sent_by, item_count, coach_note_id)
  VALUES (w.id, 'to_coach', v_me, v_open, v_note)
  RETURNING id INTO v_send;

  RETURN jsonb_build_object('send_id', v_send, 'open_questions', v_open, 'status', 'with_coach');
END $$;

-- Coach: first share (draft -> with_client) and every Send back. Releases the
-- coach drafts and completes the open Required Actions row.
CREATE OR REPLACE FUNCTION public.workbook_send_to_client(p_workbook uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me       uuid := wb_my_profile_id();
  w          workbooks%ROWTYPE;
  v_released integer;
  v_send     uuid;
BEGIN
  SELECT * INTO w FROM workbooks WHERE id = p_workbook FOR UPDATE;
  IF NOT FOUND OR v_me IS NULL OR NOT wb_is_full_coach(w.client_profile_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  WITH r AS (
    UPDATE workbook_comments SET released_at = now(), updated_at = now()
    WHERE workbook_id = w.id AND author_role = 'coach' AND released_at IS NULL
    RETURNING 1
  ) SELECT count(*)::int INTO v_released FROM r;

  UPDATE workbooks SET status = 'with_client', updated_at = now() WHERE id = w.id;

  UPDATE coach_client_notes SET completed_at = now(), updated_at = now()
  WHERE completed_at IS NULL AND id IN (
    SELECT coach_note_id FROM workbook_sends
    WHERE workbook_id = w.id AND direction = 'to_coach' AND coach_note_id IS NOT NULL
  );

  INSERT INTO workbook_sends (workbook_id, direction, sent_by, item_count)
  VALUES (w.id, 'to_client', v_me, v_released)
  RETURNING id INTO v_send;

  RETURN jsonb_build_object('send_id', v_send, 'released', v_released, 'status', 'with_client');
END $$;

-- Client: accept a suggested edit (writes the answer, history source
-- 'accepted_suggestion') or keep their own.
CREATE OR REPLACE FUNCTION public.workbook_resolve_suggestion(p_comment uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := wb_my_profile_id();
  c    workbook_comments%ROWTYPE;
  a    workbook_answers%ROWTYPE;
BEGIN
  SELECT * INTO c FROM workbook_comments WHERE id = p_comment FOR UPDATE;
  IF NOT FOUND OR NOT wb_is_client_of(c.workbook_id) OR c.kind <> 'coach_suggestion'
     OR c.released_at IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF c.suggestion_status <> 'pending' THEN
    RAISE EXCEPTION 'Suggestion already resolved' USING ERRCODE = '22023';
  END IF;

  IF p_accept THEN
    PERFORM set_config('workbook.answer_source', 'accepted_suggestion', true);
    INSERT INTO workbook_answers (workbook_id, field_key, value, updated_by_role, updated_by_id)
    VALUES (c.workbook_id, c.field_key, c.suggested_value, 'client', v_me)
    ON CONFLICT (workbook_id, field_key) DO UPDATE
      SET value = EXCLUDED.value, updated_by_role = 'client', updated_by_id = v_me
    RETURNING * INTO a;
    PERFORM set_config('workbook.answer_source', '', true);
  END IF;

  UPDATE workbook_comments
  SET suggestion_status = CASE WHEN p_accept THEN 'accepted' ELSE 'kept_own' END, updated_at = now()
  WHERE id = c.id;

  RETURN jsonb_build_object(
    'status', CASE WHEN p_accept THEN 'accepted' ELSE 'kept_own' END,
    'answer', CASE WHEN p_accept THEN to_jsonb(a) ELSE NULL END
  );
END $$;

-- Client: opening the workbook clears the Coaches Hub item for the latest send.
CREATE OR REPLACE FUNCTION public.workbook_mark_opened(p_workbook uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT wb_is_client_of(p_workbook) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE workbook_sends SET opened_at = now()
  WHERE workbook_id = p_workbook AND direction = 'to_client' AND opened_at IS NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Grants: signed-in callers only
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.wb_my_profile_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_is_full_coach(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_is_client_of(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_is_coach_of(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workbook_client_list() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workbook_for_client(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workbook_send_to_coach(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workbook_send_to_client(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workbook_resolve_suggestion(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workbook_mark_opened(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.wb_my_profile_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wb_is_full_coach(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wb_is_client_of(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wb_is_coach_of(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workbook_client_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.workbook_for_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workbook_send_to_coach(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workbook_send_to_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workbook_resolve_suggestion(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workbook_mark_opened(uuid) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workbooks, public.workbook_answers,
  public.workbook_answer_history, public.workbook_comments, public.workbook_sends,
  public.workbook_section_marks TO authenticated;
REVOKE ALL ON public.workbooks, public.workbook_answers, public.workbook_answer_history,
  public.workbook_comments, public.workbook_sends, public.workbook_section_marks FROM anon;

NOTIFY pgrst, 'reload schema';
