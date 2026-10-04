-- Package seed: what the wipe would delete. READ-ONLY (the transaction is
-- READ ONLY and rolled back). Works before or after migrations 04/05/06.
--   psql $env:DEV_DB_URL_PLAIN -v ON_ERROR_STOP=1 -f tests/package-seed/wipe-counts.sql

BEGIN READ ONLY;

\echo '== Deleted =='
SELECT 'coach_packages' AS table_name, count(*) FROM coach_packages
UNION ALL SELECT 'coach_package_milestones (package links)', count(*) FROM coach_package_milestones
UNION ALL SELECT 'coach_milestones (library deliverables)', count(*) FROM coach_milestones
UNION ALL SELECT 'coach_milestone_activities (library tasks)', count(*) FROM coach_milestone_activities
UNION ALL SELECT 'coach_client_engagements (client plans)', count(*) FROM coach_client_engagements
UNION ALL SELECT 'coach_client_engagement_deliverables', count(*) FROM coach_client_engagement_deliverables
UNION ALL SELECT 'coach_client_engagement_activities (plan tasks)', count(*) FROM coach_client_engagement_activities
UNION ALL SELECT 'coach_client_activity_notes (notes ON plan tasks, cascade)', count(*) FROM coach_client_activity_notes
UNION ALL SELECT 'coach_tasks linked to a plan task (To-Do)',
  count(*) FROM coach_tasks t WHERE to_jsonb(t)->>'plan_activity_id' IS NOT NULL;

\echo '== Plans that are proof projects (deleted with the plans) =='
SELECT count(*) AS proof_project_plans
FROM coach_client_engagements e WHERE (to_jsonb(e)->>'is_proof_project')::boolean IS TRUE;

\echo '== Kept, but touched =='
SELECT 'coach_client_documents that lose their plan-task link (doc kept)' AS what, count(*)
FROM coach_client_documents WHERE activity_id IS NOT NULL
UNION ALL SELECT 'To-Do items linked to a plan task, open', count(*)
FROM coach_tasks t WHERE to_jsonb(t)->>'plan_activity_id' IS NOT NULL AND t.status = 'open' AND t.deleted_at IS NULL;

\echo '== By coach =='
SELECT p.email,
  (SELECT count(*) FROM coach_packages x WHERE x.coach_profile_id = p.id) AS packages,
  (SELECT count(*) FROM coach_milestones x WHERE x.coach_profile_id = p.id) AS deliverables,
  (SELECT count(*) FROM coach_milestone_activities a JOIN coach_milestones m ON m.id = a.milestone_id
    WHERE m.coach_profile_id = p.id) AS library_tasks,
  (SELECT count(*) FROM coach_client_engagements e JOIN coach_clients cc ON cc.id = e.coach_client_id
    WHERE cc.coach_profile_id = p.id) AS client_plans,
  (SELECT count(DISTINCT cc.id) FROM coach_client_engagements e JOIN coach_clients cc ON cc.id = e.coach_client_id
    WHERE cc.coach_profile_id = p.id) AS clients_with_plans
FROM client_profiles p
WHERE p.id IN (SELECT coach_profile_id FROM coach_packages
               UNION SELECT coach_profile_id FROM coach_milestones
               UNION SELECT cc.coach_profile_id FROM coach_client_engagements e
                     JOIN coach_clients cc ON cc.id = e.coach_client_id)
ORDER BY p.email;

ROLLBACK;
