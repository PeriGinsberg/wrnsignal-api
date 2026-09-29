-- The homework function stops writing a reminder nowhere anybody reads.
--
-- WHY IT HAD TO CHANGE. This function has written a coach_client_notes row
-- with type='action_item' since it was created. On 2026-09-26 those rows were
-- migrated into coach_tasks and needs-attention stopped counting notes, so
-- every homework completion since then wrote a reminder into a table nothing
-- reads. The client's completion worked; the coach was simply never told. See
-- the header of app/api/coach/clients/[clientId]/needs-attention/route.ts.
--
-- AND IT DOES NOT RAISE THE TASK EITHER. An earlier draft of this file moved
-- the note into coach_tasks, which fixed the silence and created a duplicate:
-- the route raised its own task for the same event, so one completion produced
-- two rows saying the same thing in different words. The route's is the one
-- that survives, because it can resolve the session number and this function
-- cannot. See the comment at the insert site below.
--
-- So what is left here is a removal: the note is gone, nothing replaces it in
-- SQL, and the task is raised once by
-- app/api/me/workbooks/[workbookId]/homework-complete/route.ts.
--
-- Everything else is unchanged: same Forbidden guard, same one-shot timestamp,
-- same return shape. `fired` is still true only for the call that set the
-- timestamp, so a second press or a second tab still writes nothing, which is
-- what keeps the route from raising a second task.


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

    -- NO TASK IS RAISED HERE, and no note either.
    --
    -- The route raises it, for one reason: the session number. This function
    -- can only read content->>'session', which is missing on some workbooks;
    -- the route falls back to parsing the template id, and logs when even that
    -- fails. A task titled "finished Session  homework" is worse than one
    -- raised a few milliseconds later, outside the transaction.
    --
    -- The coach and client lookup that used to sit here went with it. The
    -- route does its own, from coach_client_id, which this function returns.
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
