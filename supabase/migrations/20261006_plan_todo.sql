-- Plan tasks, pass B: Active plan tasks on the To-Do list. 2026-10-06.
--
-- IN PLAIN ENGLISH
--
-- 1. A To-Do item can be the To-Do side of a plan task (plan_activity_id).
--    While a plan task is Active it has exactly one open To-Do item, for its
--    assignee, titled as the plan shows it ("Release: [task]" for a client
--    task). Finishing either one finishes the other; the app keeps them in
--    step (lib/plan/todo.ts and lib/tasks/service.ts).
-- 2. Plan tasks that are Active today get their To-Do item now, so nothing
--    Active is missing from anyone's list.
--
-- Reversibility:
--   DELETE FROM coach_tasks WHERE plan_activity_id IS NOT NULL;
--   ALTER TABLE coach_tasks DROP COLUMN IF EXISTS plan_activity_id;

BEGIN;

ALTER TABLE coach_tasks
  ADD COLUMN IF NOT EXISTS plan_activity_id UUID
    REFERENCES coach_client_engagement_activities(id) ON DELETE SET NULL;

-- One open To-Do item per plan task.
CREATE UNIQUE INDEX IF NOT EXISTS coach_tasks_plan_activity_open_idx
  ON coach_tasks (plan_activity_id)
  WHERE plan_activity_id IS NOT NULL AND status = 'open' AND deleted_at IS NULL;

INSERT INTO coach_tasks
  (title, client_profile_id, coach_client_id, assignee_profile_id, due_at, due_has_time,
   status, source, link, plan_activity_id)
SELECT
  CASE WHEN a.owner = 'client' THEN 'Release: ' || a.name ELSE a.name END,
  cc.client_profile_id,
  cc.id,
  a.assignee_profile_id,
  CASE WHEN a.due_date IS NOT NULL THEN (a.due_date::text || 'T12:00:00Z')::timestamptz END,
  FALSE,
  'open',
  'auto',
  CASE WHEN cc.client_profile_id IS NOT NULL
       THEN '/dashboard/coach/clients/' || cc.client_profile_id
       ELSE '/dashboard/coach/coach-clients/' || cc.id END,
  a.id
FROM coach_client_engagement_activities a
JOIN coach_client_engagement_deliverables d ON d.id = a.engagement_deliverable_id
JOIN coach_client_engagements e ON e.id = d.engagement_id
JOIN coach_clients cc ON cc.id = e.coach_client_id
WHERE a.state = 'active'
  AND NOT d.not_needed
  AND a.assignee_profile_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM coach_tasks t
    WHERE t.plan_activity_id = a.id AND t.status = 'open' AND t.deleted_at IS NULL
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
