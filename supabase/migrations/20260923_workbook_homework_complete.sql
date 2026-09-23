-- 20260923_workbook_homework_complete.sql
-- "Mark homework complete" on a session workbook (docs/workbook-templates/).
--
-- FIRE ONCE, DECIDED BY THE DATABASE. The button is a client action that must
-- reach an external webhook exactly once per workbook. A UI guard cannot promise
-- that (two tabs, a double click, a retried request), so the promise lives here:
-- workbook_mark_homework_complete() sets homework_completed_at only when it is
-- still NULL and reports whether THIS call was the one that set it. The route
-- posts to the webhook only on that answer.
--
-- The webhook stamp is separate: a completion that cannot reach the webhook is
-- still a completion, so homework_completed_at is set regardless and
-- homework_webhook_at stays NULL until a POST succeeds, leaving a retry possible
-- without ever re-opening the "first completion" gate.

ALTER TABLE public.workbooks
  ADD COLUMN IF NOT EXISTS homework_completed_at timestamptz,
  -- NULL after completion means the webhook has not been delivered yet.
  ADD COLUMN IF NOT EXISTS homework_webhook_at timestamptz;

-- The client marks their own homework complete. Also raises ONE Required Actions
-- row for the coach, in the same transaction, so the queue item cannot go missing
-- when the webhook fails.
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
    'title', v_title
  );
END $$;

-- Stamped by the route after a successful POST. Owner-only; never re-opens the
-- completion gate.
CREATE OR REPLACE FUNCTION public.workbook_record_homework_webhook(p_workbook uuid)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_at timestamptz;
BEGIN
  IF NOT wb_is_client_of(p_workbook) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE workbooks SET homework_webhook_at = COALESCE(homework_webhook_at, now())
  WHERE id = p_workbook
  RETURNING homework_webhook_at INTO v_at;
  RETURN v_at;
END $$;

-- The client read carries the homework state, so the page can show the button or
-- the date it was completed.
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
    ) END
  )
  FROM workbooks w
  LEFT JOIN signal_interviews si ON si.id = w.signal_interview_id
  WHERE w.id = p_workbook
    AND w.client_profile_id = wb_my_profile_id()
    AND w.status <> 'draft'
$$;

REVOKE ALL ON FUNCTION public.workbook_mark_homework_complete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workbook_record_homework_webhook(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workbook_mark_homework_complete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workbook_record_homework_webhook(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
