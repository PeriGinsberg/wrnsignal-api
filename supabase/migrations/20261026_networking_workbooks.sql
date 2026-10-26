-- 20261026_networking_workbooks.sql
-- A CLIENT CAN NOW CREATE A WORKBOOK: the Networking Call workbook, one per
-- contact on their networking board.
--
-- Every workbook so far was made by a coach (or the operator script) and hung
-- off the coach relationship that made it. This one is made by the client, from
-- the Networking page, and the client may have no coach at all. So:
--
--   1. coach_client_id becomes NULLABLE. A networking workbook made by a client
--      with no coach has no relationship to hang off. Coach-made workbooks are
--      unchanged: the coach insert policy still requires a real, active, full
--      link, so a NULL can only come from the client create route.
--
--   2. network_contact_id links the workbook to its contact, one per contact.
--      ON DELETE SET NULL: closing out a contact does not destroy what the
--      client wrote about them. The contact's name is frozen in the content.
--
--   3. workbook_send_to_coach routes a networking workbook to the client's LEAD
--      COACH, resolved at send time, so a client who gets a coach after writing
--      it can still send it. It also stops filing the Required Action under the
--      client: created_by is the client on these rows, and the old
--      COALESCE(w.created_by, ...) would have made the client the "coach".
--
--   4. The client read functions return the contact, the kind, and whether
--      there is a coach to send to (the UI hides Send without one).
--
-- Creation itself is NOT a client RLS policy. The route checks the contact is
-- the caller's own and writes with the service role, so the content always comes
-- from the repo's template and never from the browser.

ALTER TABLE public.workbooks ALTER COLUMN coach_client_id DROP NOT NULL;

ALTER TABLE public.workbooks ADD COLUMN IF NOT EXISTS network_contact_id uuid
  REFERENCES public.network_contacts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS workbooks_one_per_contact
  ON public.workbooks (network_contact_id) WHERE network_contact_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The client's lead coach: the active, full-access relationship accepted first.
-- Full access because a view/annotate coach cannot open workbooks at all.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wb_lead_coach_link(p_client uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cc.id FROM coach_clients cc
  WHERE cc.client_profile_id = p_client AND cc.status = 'active' AND cc.access_level = 'full'
  ORDER BY cc.accepted_at ASC NULLS LAST, cc.invited_at ASC NULLS LAST, cc.id
  LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- Send to coach
-- ---------------------------------------------------------------------------

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
  v_link    uuid;
BEGIN
  SELECT * INTO w FROM workbooks WHERE id = p_workbook FOR UPDATE;
  IF NOT FOUND OR v_me IS NULL OR w.client_profile_id <> v_me OR w.status = 'draft' THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- A networking workbook goes to whoever is the lead coach NOW. Checked before
  -- anything is released, so a client with no coach changes nothing.
  IF w.content->>'kind' = 'networking' THEN
    v_link := wb_lead_coach_link(w.client_profile_id);
    IF v_link IS NULL THEN
      RAISE EXCEPTION 'You do not have a coach to send this to yet' USING ERRCODE = '22023';
    END IF;
    IF w.coach_client_id IS DISTINCT FROM v_link THEN
      UPDATE workbooks SET coach_client_id = v_link WHERE id = w.id;
      w.coach_client_id := v_link;
    END IF;
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

  v_body := v_first || ' sent the workbook for review'
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
    -- The coach who made the workbook gets it back; a workbook the CLIENT made
    -- goes to the relationship's coach, never to the client.
    SELECT CASE WHEN w.created_by IS NULL OR w.created_by = w.client_profile_id
                THEN cc.coach_profile_id ELSE w.created_by END
      INTO v_coach
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

  RETURN jsonb_build_object(
    'send_id', v_send, 'open_questions', v_open, 'status', 'with_coach',
    -- Which relationship this happened in, so the route can log it.
    'coach_client_id', w.coach_client_id,
    'title', COALESCE(NULLIF(w.content->>'title', ''), w.slug)
  );
END $$;

-- ---------------------------------------------------------------------------
-- Client reads
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.workbook_for_client(p_workbook uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', w.id,
    'slug', w.slug,
    'status', w.status,
    'updated_at', w.updated_at,
    'homework_completed_at', w.homework_completed_at,
    'content', wb_strip_coach_only(w.content),
    'interview', CASE WHEN si.id IS NULL THEN NULL ELSE jsonb_build_object(
      'company_name', si.company_name,
      'job_title', si.job_title,
      'interview_date', si.interview_date,
      'interview_at', si.interview_at,
      'interviewer_names', si.interviewer_names
    ) END,
    'network_contact_id', w.network_contact_id,
    -- Whether Send to coach can go anywhere. Every workbook a coach made has a
    -- coach; a networking workbook asks the lead-coach rule the send will use.
    'has_coach', CASE WHEN w.content->>'kind' = 'networking'
                      THEN wb_lead_coach_link(w.client_profile_id) IS NOT NULL
                      ELSE true END,
    -- The live lead coach's first name for a networking workbook, whose content
    -- may have been written before the client had a coach.
    'coach_first_name', CASE WHEN w.content->>'kind' = 'networking' THEN (
      SELECT NULLIF(split_part(cp.name, ' ', 1), '')
      FROM coach_clients cc JOIN client_profiles cp ON cp.id = cc.coach_profile_id
      WHERE cc.id = wb_lead_coach_link(w.client_profile_id)
    ) END
  )
  FROM workbooks w
  LEFT JOIN signal_interviews si ON si.id = w.signal_interview_id
  WHERE w.id = p_workbook
    AND w.client_profile_id = wb_my_profile_id()
    AND w.status <> 'draft'
$$;

-- New columns change the return type, so this one is dropped and recreated.
DROP FUNCTION IF EXISTS public.workbook_client_list();

CREATE FUNCTION public.workbook_client_list()
RETURNS TABLE (
  id uuid, slug text, status text, updated_at timestamptz,
  company text, role text, interview_date date, coach_first_name text,
  sends_to_client integer, last_to_client_at timestamptz, last_to_client_opened_at timestamptz,
  kind text, title text, network_contact_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.slug, w.status, w.updated_at,
         COALESCE(NULLIF(si.company_name, ''), w.content->'interview'->>'company'),
         COALESCE(NULLIF(si.job_title, ''), w.content->'interview'->>'role'),
         COALESCE(si.interview_date, (w.content->'interview'->>'date')::date),
         w.content->'coach'->>'first_name',
         (SELECT count(*)::int FROM workbook_sends s WHERE s.workbook_id = w.id AND s.direction = 'to_client'),
         ls.sent_at, ls.opened_at,
         w.content->>'kind', w.content->>'title', w.network_contact_id
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

-- The lead-coach helper is called only from the definer functions above, which
-- run as the owner. No grant: a client has no business looking up another
-- client's relationship id.
REVOKE ALL ON FUNCTION public.wb_lead_coach_link(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workbook_client_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workbook_client_list() TO authenticated;

NOTIFY pgrst, 'reload schema';
