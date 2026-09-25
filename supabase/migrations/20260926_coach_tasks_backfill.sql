-- ═══════════════════════════════════════════════════
-- Backfill: coach_client_notes action items -> coach_tasks — 2026-09-26
-- ═══════════════════════════════════════════════════
--
-- IN PLAIN ENGLISH
--
-- Moves every existing Action Item into the new tasks table. 55 of them in prod
-- at the time of writing, counting only the ones not soft-deleted.
--
-- IT DOES NOT TOUCH coach_client_notes. The originals stay exactly where they
-- are, still type = 'action_item', still served by /api/coach/action-items,
-- until that endpoint has been repointed and verified. Until then the two are
-- simply two copies, and the old one is still the one the app reads. Deleting
-- the originals is a separate migration, after Step 3.
--
-- SAFE TO RUN TWICE. coach_tasks.legacy_note_id is UNIQUE and the insert skips
-- conflicts, so a second run inserts nothing rather than duplicating all 55.
--
-- Reversibility:
--   DELETE FROM coach_tasks WHERE legacy_note_id IS NOT NULL;
--   (coach_task_events rows cascade)

-- ---------------------------------------------------------------------------
-- The mapping, and the two judgement calls in it
-- ---------------------------------------------------------------------------
--
-- TITLE. The old rows have `body` and no title. Title becomes the first line,
-- capped at 200 characters. Description becomes the whole body, but ONLY when
-- the body is more than that first capped line, so the common one-line action
-- item does not render as the same sentence twice. Nothing is lost either way:
-- when description is NULL, title is the entire body.
--
-- ASSIGNEE. The old rows have no assignee. coach_profile_id, the coach who
-- wrote the note, becomes the assignee. That is the only defensible reading:
-- these were that coach's own list.
--
-- PRIORITY IS NOT DROPPED, AND NOT TURNED INTO A DUE DATE. The old rows carry
-- priority ('urgent' / 'this_week' / 'when_ready'); the new model has no such
-- field. Mapping it onto due_at would invent dates nobody chose, and would put
-- fabricated deadlines straight into the overdue digest on day one. Instead the
-- original value is preserved on the task's 'created' audit event, so it can be
-- read later if it turns out to matter. due_at stays NULL.

INSERT INTO coach_tasks (
  title,
  description,
  client_profile_id,
  coach_client_id,
  assignee_profile_id,
  created_by_profile_id,
  due_at,
  status,
  completed_at,
  source,
  legacy_note_id,
  created_at,
  updated_at,
  deleted_at
)
SELECT
  COALESCE(
    NULLIF(LEFT(SPLIT_PART(n.body, E'\n', 1), 200), ''),
    'Action item'
  ) AS title,

  CASE
    WHEN LENGTH(n.body) > LENGTH(LEFT(SPLIT_PART(n.body, E'\n', 1), 200))
      THEN n.body
    ELSE NULL
  END AS description,

  n.client_profile_id,
  n.coach_client_id,
  n.coach_profile_id AS assignee_profile_id,
  n.coach_profile_id AS created_by_profile_id,

  NULL::timestamptz AS due_at,

  CASE WHEN n.completed_at IS NULL THEN 'open' ELSE 'done' END AS status,
  n.completed_at,

  'manual' AS source,

  n.id AS legacy_note_id,

  n.created_at,
  n.updated_at,
  n.deleted_at
FROM coach_client_notes n
WHERE n.type = 'action_item'
ON CONFLICT (legacy_note_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- The audit event, carrying the priority the new model has no column for
-- ---------------------------------------------------------------------------
INSERT INTO coach_task_events (task_id, kind, actor_profile_id, note, payload)
SELECT
  t.id,
  'created',
  t.created_by_profile_id,
  'Migrated from coach_client_notes',
  jsonb_build_object(
    'migrated_from',   'coach_client_notes',
    'legacy_note_id',  n.id,
    'legacy_priority', n.priority,
    'legacy_link_tab', n.link_tab
  )
FROM coach_tasks t
JOIN coach_client_notes n ON n.id = t.legacy_note_id
WHERE NOT EXISTS (
  SELECT 1 FROM coach_task_events e
  WHERE e.task_id = t.id AND e.kind = 'created'
);

-- ---------------------------------------------------------------------------
-- Verification. Run these after; they are the point of the migration.
-- ---------------------------------------------------------------------------
-- Must be equal:
--   SELECT
--     (SELECT COUNT(*) FROM coach_client_notes WHERE type = 'action_item') AS notes,
--     (SELECT COUNT(*) FROM coach_tasks WHERE legacy_note_id IS NOT NULL)  AS tasks;
--
-- Must return zero rows (nothing lost, nothing invented):
--   SELECT t.id, t.title
--   FROM coach_tasks t JOIN coach_client_notes n ON n.id = t.legacy_note_id
--   WHERE (t.description IS NULL AND t.title <> n.body)
--      OR (t.description IS NOT NULL AND t.description <> n.body)
--      OR (n.completed_at IS NULL) <> (t.status = 'open')
--      OR t.due_at IS NOT NULL;
--
-- Must return zero rows (every assignee is really a coach):
--   SELECT t.id FROM coach_tasks t
--   JOIN client_profiles p ON p.id = t.assignee_profile_id
--   WHERE p.is_coach IS NOT TRUE;
