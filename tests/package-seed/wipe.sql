-- Package seed: wipe every package, library deliverable, library task and
-- client plan (with its deliverables, tasks, notes on those tasks and the
-- To-Do items linked to them), for EVERY coach in the database.
--
-- Kept: clients, prospects, coach notes, History (coach_client_events), jobs,
-- phases and client phase status, shared documents (a document linked to a
-- plan task stays, unlinked).
--
-- Runs before or after migration 20261006_plan_todo.sql: plan_activity_id is
-- read through to_jsonb, so its absence just means no linked To-Do items.
-- One transaction; with ON_ERROR_STOP any failure rolls the whole thing back.
-- Run wipe-counts.sql first and compare against the counts printed here.
--   psql $env:DEV_DB_URL_PLAIN -v ON_ERROR_STOP=1 -f tests/package-seed/wipe.sql

BEGIN;

-- 1. To-Do items that are the To-Do side of a plan task (the FK would only
--    null them out, leaving orphans on people's lists).
WITH d AS (DELETE FROM coach_tasks t WHERE to_jsonb(t)->>'plan_activity_id' IS NOT NULL RETURNING 1)
SELECT 'coach_tasks (plan To-Do) deleted' AS step, count(*) FROM d;

-- 2. Client plans. Cascades to their deliverables, tasks and the notes on
--    those tasks; shared documents linked to a task keep the document.
WITH d AS (DELETE FROM coach_client_engagements RETURNING 1)
SELECT 'coach_client_engagements deleted' AS step, count(*) FROM d;

-- 3. Packages (cascades their deliverable links).
WITH d AS (DELETE FROM coach_packages RETURNING 1)
SELECT 'coach_packages deleted' AS step, count(*) FROM d;

-- 4. Library deliverables (cascades their tasks).
WITH d AS (DELETE FROM coach_milestones RETURNING 1)
SELECT 'coach_milestones deleted' AS step, count(*) FROM d;

-- Nothing left behind, or nothing commits.
DO $$
DECLARE n bigint;
BEGIN
  SELECT (SELECT count(*) FROM coach_packages) + (SELECT count(*) FROM coach_package_milestones)
       + (SELECT count(*) FROM coach_milestones) + (SELECT count(*) FROM coach_milestone_activities)
       + (SELECT count(*) FROM coach_client_engagements) + (SELECT count(*) FROM coach_client_engagement_deliverables)
       + (SELECT count(*) FROM coach_client_engagement_activities) + (SELECT count(*) FROM coach_client_activity_notes)
       + (SELECT count(*) FROM coach_tasks t WHERE to_jsonb(t)->>'plan_activity_id' IS NOT NULL)
    INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'wipe left % rows behind; rolling back', n; END IF;
  RAISE NOTICE 'wipe verified: 0 rows left in all nine';
END $$;

COMMIT;
