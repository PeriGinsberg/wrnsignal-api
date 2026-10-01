-- Catch-up: every action-item note gets its task, and every such task links
-- back to its note. 2026-09-30.
--
-- IN PLAIN ENGLISH
--
-- On 2026-09-26 the action items that existed were copied into coach_tasks
-- (20260926_coach_tasks_backfill.sql) and the dashboard switched to reading
-- tasks. The prospect page kept saving new action items as bare notes, so every
-- one written there since then (a "Draft SOW" on a new prospect, for one)
-- appears on no dashboard surface. From 2026-09-30 the app creates the task
-- with the note. This file does the same for the notes written in between.
--
-- It also gives every note-backed task a link back to its note, including the
-- 55 the first backfill copied, which were created without one.
--
-- TWO KINDS OF ACTION-ITEM NOTE ARE CAUGHT UP:
--   - ones a coach wrote (the prospect page's): a manual task by that coach,
--     linked to the note;
--   - ones SIGNAL wrote when a client sent a workbook back for review
--     (workbook_send_to_coach still writes these): a system task, linked to
--     the workbook, which is where that work is done. The route now makes
--     these tasks as they happen; this covers the ones written before it did.
--
-- RUN THE PREVIEW FIRST. It lists exactly the tasks step 1 would create, so an
-- unexpectedly long list (old open workbook items, say) is seen before it
-- lands on anyone's dashboard:
--
--   SELECT n.id, n.created_at, n.body, n.completed_at IS NOT NULL AS done,
--          n.coach_client_id, n.client_profile_id, n.link_tab
--   FROM coach_client_notes n
--   WHERE n.type = 'action_item' AND n.deleted_at IS NULL
--     AND NOT EXISTS (SELECT 1 FROM coach_tasks t WHERE t.legacy_note_id = n.id)
--   ORDER BY n.created_at;
--
-- WHY A NEW FILE AND NOT A SECOND RUN OF THE 2026-09-26 BACKFILL. That file is
-- safe to run again (its insert skips notes that already have a task, through
-- the UNIQUE legacy_note_id, and its audit insert skips tasks that already
-- have a 'created' event), and on its own it would create the missing tasks.
-- But it writes them with no link, and the link back to the note is half of
-- what the new model promises. Same mapping as that file otherwise, so old and
-- new rows read alike.
--
-- SAFE TO RUN TWICE, for the same reasons: ON CONFLICT (legacy_note_id) DO
-- NOTHING, NOT EXISTS on the audit event, and the link update touches only
-- rows whose link is still NULL.
--
-- NO DUE DATE IS INVENTED. The notes carry a priority, not a date, and turning
-- one into the other would put deadlines nobody chose into the overdue digest.
-- The priority is kept on the task's 'created' audit event, as before. A coach
-- who wants a date sets it on the task or by editing the note.
--
-- Reversibility (the tasks this file created are the ones with this audit note):
--   DELETE FROM coach_tasks WHERE id IN (
--     SELECT task_id FROM coach_task_events
--     WHERE note = 'Caught up from coach_client_notes, 2026-09-30');
--   UPDATE coach_tasks SET link = NULL
--     WHERE legacy_note_id IS NOT NULL
--       AND (link LIKE '%#note-%' OR link LIKE '%?tab=workbooks&workbook=%')
--       AND source = 'manual';

-- ---------------------------------------------------------------------------
-- 1. The missing tasks
-- ---------------------------------------------------------------------------
INSERT INTO coach_tasks (
  title, description, client_profile_id, coach_client_id,
  assignee_profile_id, created_by_profile_id, due_at,
  status, completed_at, source, legacy_note_id, link,
  created_at, updated_at, deleted_at
)
SELECT
  COALESCE(NULLIF(LEFT(SPLIT_PART(n.body, E'\n', 1), 200), ''), 'Action item'),
  CASE WHEN LENGTH(n.body) > LENGTH(LEFT(SPLIT_PART(n.body, E'\n', 1), 200)) THEN n.body ELSE NULL END,
  n.client_profile_id,
  n.coach_client_id,
  n.coach_profile_id,
  -- SIGNAL wrote the workbook ones; a coach wrote the rest.
  CASE WHEN ws.workbook_id IS NULL THEN n.coach_profile_id ELSE NULL END,
  NULL::timestamptz,
  CASE WHEN n.completed_at IS NULL THEN 'open' ELSE 'done' END,
  n.completed_at,
  CASE WHEN ws.workbook_id IS NULL THEN 'manual' ELSE 'auto' END,
  n.id,
  -- Same shapes as noteLink() and workbookLink() in lib/tasks/links.ts.
  CASE
    WHEN ws.workbook_id IS NOT NULL AND n.client_profile_id IS NOT NULL
      THEN '/dashboard/coach/clients/' || n.client_profile_id || '?tab=workbooks&workbook=' || ws.workbook_id
    WHEN n.client_profile_id IS NOT NULL
      THEN '/dashboard/coach/clients/' || n.client_profile_id || '?tab=notes#note-' || n.id
    ELSE '/dashboard/coach/prospects/' || n.coach_client_id || '#note-' || n.id
  END,
  n.created_at,
  n.updated_at,
  n.deleted_at
FROM coach_client_notes n
LEFT JOIN LATERAL (
  SELECT s.workbook_id FROM workbook_sends s
  WHERE s.coach_note_id = n.id ORDER BY s.sent_at DESC LIMIT 1
) ws ON true
WHERE n.type = 'action_item'
ON CONFLICT (legacy_note_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Their audit event, carrying the priority the task has no column for
-- ---------------------------------------------------------------------------
INSERT INTO coach_task_events (task_id, kind, actor_profile_id, note, payload)
SELECT
  t.id,
  'created',
  t.created_by_profile_id,
  'Caught up from coach_client_notes, 2026-09-30',
  jsonb_build_object(
    'migrated_from',   'coach_client_notes',
    'legacy_note_id',  n.id,
    'legacy_priority', n.priority,
    'legacy_link_tab', n.link_tab
  )
FROM coach_tasks t
JOIN coach_client_notes n ON n.id = t.legacy_note_id
WHERE NOT EXISTS (
  SELECT 1 FROM coach_task_events e WHERE e.task_id = t.id AND e.kind = 'created'
);

-- ---------------------------------------------------------------------------
-- 3. A link back to the note on every note-backed task that has none
-- ---------------------------------------------------------------------------
UPDATE coach_tasks t
SET link = CASE
    WHEN ws.workbook_id IS NOT NULL AND n.client_profile_id IS NOT NULL
      THEN '/dashboard/coach/clients/' || n.client_profile_id || '?tab=workbooks&workbook=' || ws.workbook_id
    WHEN n.client_profile_id IS NOT NULL
      THEN '/dashboard/coach/clients/' || n.client_profile_id || '?tab=notes#note-' || n.id
    ELSE '/dashboard/coach/prospects/' || n.coach_client_id || '#note-' || n.id
  END
FROM coach_client_notes n
LEFT JOIN LATERAL (
  SELECT s.workbook_id FROM workbook_sends s
  WHERE s.coach_note_id = n.id ORDER BY s.sent_at DESC LIMIT 1
) ws ON true
WHERE n.id = t.legacy_note_id
  AND t.link IS NULL;

-- ---------------------------------------------------------------------------
-- Verification. Run these after.
-- ---------------------------------------------------------------------------
-- Must be equal (every action item has exactly one task):
--   SELECT
--     (SELECT COUNT(*) FROM coach_client_notes WHERE type = 'action_item') AS notes,
--     (SELECT COUNT(*) FROM coach_tasks t JOIN coach_client_notes n ON n.id = t.legacy_note_id
--        WHERE n.type = 'action_item') AS tasks;
--
-- Must return zero rows (every note-backed task links back):
--   SELECT id FROM coach_tasks WHERE legacy_note_id IS NOT NULL AND link IS NULL;
--
-- Must return zero rows (open and done agree between note and task):
--   SELECT t.id FROM coach_tasks t JOIN coach_client_notes n ON n.id = t.legacy_note_id
--   WHERE n.type = 'action_item' AND t.status <> 'cancelled'
--     AND (n.completed_at IS NULL) <> (t.status = 'open');
--
-- The one that started this. Should list the prospect's "Draft SOW":
--   SELECT t.title, t.status, t.link FROM coach_tasks t
--   WHERE t.title ILIKE 'Draft SOW%';
