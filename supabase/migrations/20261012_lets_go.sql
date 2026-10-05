-- Let's Go: the client accepts their SOW. 2026-10-12.
--
-- IN PLAIN ENGLISH
--
-- 1. coach_clients.workspace_folder_id / _url: the client's Google Drive
--    workspace, "[First Last]" under the clients folder with its subfolders,
--    made when they click Let's Go. It is NOT drive_folder_id, which stays the
--    Networking folder the Networking Plan writes into; Let's Go fills that
--    with the workspace's Networking subfolder only when it is empty.
-- 2. coach_client_engagement_activities.welcome_release: the one client task
--    whose To-Do item reads "Send welcome email (releases: [task])". Releasing
--    it shares the workspace with the client.
-- 3. An Onboarding stage in every coach's pipeline, right after SOW Executed
--    (or just before Convert to Client when a coach has no SOW Executed).
--    The stages after it move down one; nothing else changes.
--
-- Additive, and safe to run twice (a coach who has Onboarding is skipped).
--
-- Reversibility:
--   DELETE FROM coach_pipeline_stages WHERE stage_key = 'onboarding' AND NOT is_custom;
--     (then renumber, or leave the gap: order is relative)
--   ALTER TABLE coach_client_engagement_activities DROP COLUMN IF EXISTS welcome_release;
--   ALTER TABLE coach_clients DROP COLUMN IF EXISTS workspace_folder_id, DROP COLUMN IF EXISTS workspace_folder_url;

ALTER TABLE coach_clients
  ADD COLUMN IF NOT EXISTS workspace_folder_id  TEXT,
  ADD COLUMN IF NOT EXISTS workspace_folder_url TEXT;

ALTER TABLE coach_client_engagement_activities
  ADD COLUMN IF NOT EXISTS welcome_release BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
DECLARE
  c   RECORD;
  pos INTEGER;
BEGIN
  FOR c IN
    SELECT DISTINCT coach_profile_id FROM coach_pipeline_stages s
    WHERE NOT EXISTS (
      SELECT 1 FROM coach_pipeline_stages o WHERE o.coach_profile_id = s.coach_profile_id AND o.stage_key = 'onboarding'
    )
  LOOP
    SELECT sort_order + 1 INTO pos FROM coach_pipeline_stages
     WHERE coach_profile_id = c.coach_profile_id AND stage_key = 'sow_executed';
    IF pos IS NULL THEN
      SELECT min(sort_order) INTO pos FROM coach_pipeline_stages
       WHERE coach_profile_id = c.coach_profile_id AND is_terminal;
    END IF;
    IF pos IS NULL THEN
      SELECT coalesce(max(sort_order), 0) + 1 INTO pos FROM coach_pipeline_stages WHERE coach_profile_id = c.coach_profile_id;
    END IF;
    UPDATE coach_pipeline_stages SET sort_order = sort_order + 1
     WHERE coach_profile_id = c.coach_profile_id AND sort_order >= pos;
    INSERT INTO coach_pipeline_stages (coach_profile_id, stage_key, label, sort_order, is_custom, is_terminal, active)
    VALUES (c.coach_profile_id, 'onboarding', 'Onboarding', pos, FALSE, FALSE, TRUE);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
