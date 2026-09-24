-- 20260924_workbook_session_number.sql
-- THE HOMEWORK WEBHOOK REPORTS WHICH SESSION IT WAS, SO SOMETHING HAS TO KNOW.
--
-- workbook_mark_homework_complete returned template_id and the route parsed a
-- number out of it with a regex, falling back to 1. That fallback is the danger:
-- a workbook with no template_id did not fail, it announced itself as Session 1.
--
-- Templates now state their session (content->>'session'), so this returns it.
-- Nothing else about the function changes: same guard, same one-shot timestamp,
-- same Required Actions row, same keys plus 'session'. template_id stays in the
-- payload so the route can still fall back for workbooks created before this.

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
    'title', v_title
  );
END $$;

NOTIFY pgrst, 'reload schema';
