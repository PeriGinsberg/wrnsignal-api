-- The homework Required Action goes into coach_tasks, where the coach reads.
--
-- WHY IT HAD TO MOVE. This function has written a coach_client_notes row with
-- type='action_item' since it was created. On 2026-09-26 those rows were
-- migrated into coach_tasks and needs-attention stopped counting notes, so
-- every homework completion since then has written a reminder into a table
-- nothing reads. The client's completion worked; the coach was simply never
-- told. See the header of
-- app/api/coach/clients/[clientId]/needs-attention/route.ts.
--
-- Everything else is unchanged: same Forbidden guard, same one-shot timestamp,
-- same return shape. `fired` is still true only for the call that set the
-- timestamp, so a second press or a second tab still writes nothing.
--
-- THE NOTE IS NOT KEPT AS WELL. Writing both would put the same reminder in
-- two places and make the History tab and the task list disagree about how
-- much work there is.

CREATE OR REPLACE FUNCTION public.workbook_mark_homework_complete(p_workbook uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me     uuid := wb_my_profile_id();
  w        workbooks%ROWTYPE;
  v_first  text;
  v_last   text;
  v_email  text;
  v_title  text;
  v_coach  uuid;
  v_client uuid;
  v_fired  boolean := false;
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

    SELECT COALESCE(w.created_by, cc.coach_profile_id), cc.client_profile_id
      INTO v_coach, v_client
      FROM coach_clients cc WHERE cc.id = w.coach_client_id;

    -- A REAL TASK. assignee_profile_id is what puts it in the coach's queue;
    -- client_profile_id is what puts it on the client's page. source='auto'
    -- so the row reads as something a rule produced, not something a coach
    -- typed, which is what the task list uses to phrase it.
    IF v_coach IS NOT NULL THEN
      INSERT INTO coach_tasks
        (coach_client_id, client_profile_id, assignee_profile_id,
         title, description, status, source)
      VALUES
        (w.coach_client_id,
         COALESCE(v_client, w.client_profile_id),
         v_coach,
         v_first || ' finished the homework: ' || v_title,
         'Review it in SIGNAL, then send your video reply.',
         'open',
         'auto');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'fired', v_fired,
    'completed_at', w.homework_completed_at,
    'webhook_sent_at', w.homework_webhook_at,
    'email', v_email, 'first_name', v_first, 'last_name', v_last,
    'template_id', w.content->>'template_id',
    'session', (w.content->>'session')::int,
    'title', v_title
  );
END $$;

REVOKE ALL ON FUNCTION public.workbook_mark_homework_complete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workbook_mark_homework_complete(uuid) TO authenticated;
