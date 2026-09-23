-- 20260923_coach_client_drive_folder.sql
-- FRD: docs/Features/networking-plan-delivery-frd.md
--
-- Where this client's coaching artifacts live in our Shared Drive.
--
-- On coach_clients, not on client_profiles: the folder belongs to the COACHING
-- RELATIONSHIP, and it should die with it. A client who leaves one coach and
-- joins another does not keep the first coach's folder.
--
-- The id is what every Drive call uses. The url is stored alongside purely so a
-- settings screen can show a link back to the folder the coach pasted, and so a
-- human debugging a wrong-folder report can see what was actually entered
-- rather than an opaque id.
--
-- Both nullable: a relationship has no folder until someone wires one up, and a
-- job that runs without one creates the folder and fills these in.

ALTER TABLE public.coach_clients
  ADD COLUMN IF NOT EXISTS drive_folder_id  text,
  ADD COLUMN IF NOT EXISTS drive_folder_url text;

-- Rollback:
--   ALTER TABLE public.coach_clients
--     DROP COLUMN IF EXISTS drive_folder_id,
--     DROP COLUMN IF EXISTS drive_folder_url;
