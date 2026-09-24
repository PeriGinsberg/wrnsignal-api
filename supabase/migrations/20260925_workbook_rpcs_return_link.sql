-- 20260925_workbook_rpcs_return_link.sql
-- THE CLIENT'S WORKBOOK ROUTES NEED TO KNOW WHICH RELATIONSHIP THEY ARE IN.
--
-- History is written per coach_clients row, and the coach routes have it from
-- resolveScope. The client's routes do not: a client cannot read `workbooks`
-- directly (there is no client SELECT policy on it, by design), so everything
-- they know about their own workbook comes from these functions' return values.
--
-- So both return coach_client_id now. Nothing else changes in either function:
-- same guards, same writes, same existing keys. Two functions, one reason, one
-- migration.

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

  RETURN jsonb_build_object(
    'send_id', v_send, 'open_questions', v_open, 'status', 'with_coach',
    -- Which relationship this happened in, so the route can log it.
    'coach_client_id', w.coach_client_id,
    'title', COALESCE(NULLIF(w.content->>'title', ''), w.slug)
  );
END $$;

CREATE OR REPLACE FUNCTION public.workbook_mark_homework_complete(p_workbook uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me    uuid := wb_my_profile_id();
  w       workbooks%ROWTYPE;
  v_first text;
  v_last  text;
  v_email text;
  v_title text;
  v_coach uuid;
  v_fired boolean := false;
BEGIN
  SELECT * INTO w FROM workbooks WHERE id = p_workbook FOR UPDATE;
  IF NOT FOUND OR v_me IS NULL OR w.client_profile_id <> v_me OR w.status = 'draft' THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT cp.email,
         COALESCE(NULLIF(w.content->'client'->>'first_name', ''), NULLIF(split_part(cp.name, ' ', 1), ''), 'Your client'),
         NULLIF(substr(cp.name, length(split_part(cp.name, ' ', 1)) + 2), '')
    INTO v_email, v_first, v_last
    FROM client_profiles cp WHERE cp.id = w.client_profile_id;

  v_title := COALESCE(NULLIF(w.content->>'title', ''), w.slug);

  IF w.homework_completed_at IS NULL THEN
    UPDATE workbooks SET homework_completed_at = now(), updated_at = now() WHERE id = w.id
    RETURNING homework_completed_at INTO w.homework_completed_at;
    v_fired := true;

    SELECT COALESCE(w.created_by, cc.coach_profile_id) INTO v_coach
    FROM coach_clients cc WHERE cc.id = w.coach_client_id;

    INSERT INTO coach_client_notes
      (coach_client_id, coach_profile_id, client_profile_id, type, priority, body, link_tab)
    VALUES
      (w.coach_client_id, v_coach, w.client_profile_id, 'action_item', 'this_week',
       v_first || ' marked homework complete: ' || v_title, 'workbooks');
  END IF;

  RETURN jsonb_build_object(
    'fired', v_fired,                                  -- true only for the call that set it
    'completed_at', w.homework_completed_at,
    'webhook_sent_at', w.homework_webhook_at,
    'email', v_email, 'first_name', v_first, 'last_name', v_last,
    'template_id', w.content->>'template_id',
    -- Stated by the template. NULL on anything that never declared one, which
    -- the route reports rather than guessing at.
    'session', CASE WHEN jsonb_typeof(w.content->'session') = 'number'
                    THEN (w.content->>'session')::int END,
    -- Which relationship this happened in, so the route can log it.
    'coach_client_id', w.coach_client_id,
    'title', v_title
  );
END $$;

NOTIFY pgrst, 'reload schema';
