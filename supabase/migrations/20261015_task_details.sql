-- Task details. 2026-10-07.
--
-- IN PLAIN ENGLISH
--
-- 1. Library tasks (coach_milestone_activities) and clients' plan tasks
--    (coach_client_engagement_activities) get a `details` field: plain text,
--    a checklist one item per line, up to 2,000 characters.
-- 2. Attaching a package copies each task's details with its name and owner.
--    The copy is the client's own from then on: editing the library later does
--    not change plans already attached, the same as task names.
-- 3. Who sees it is decided in the app, not here: details on a client task show
--    to the client once the task is released; details on a coach task never
--    leave the coach side (the client's API returns only client tasks).
--
-- Additive: two nullable columns and the attach function replaced with one
-- that also copies details. Safe to run twice.
--
-- Reversibility:
--   ALTER TABLE coach_milestone_activities DROP COLUMN IF EXISTS details;
--   ALTER TABLE coach_client_engagement_activities DROP COLUMN IF EXISTS details;
--   (then re-run section 4 of 20261004_client_phases.sql to restore the function)

ALTER TABLE coach_milestone_activities
  ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE coach_client_engagement_activities
  ADD COLUMN IF NOT EXISTS details TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coach_milestone_activities_details_len') THEN
    ALTER TABLE coach_milestone_activities
      ADD CONSTRAINT coach_milestone_activities_details_len CHECK (details IS NULL OR char_length(details) <= 2000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coach_client_engagement_activities_details_len') THEN
    ALTER TABLE coach_client_engagement_activities
      ADD CONSTRAINT coach_client_engagement_activities_details_len CHECK (details IS NULL OR char_length(details) <= 2000);
  END IF;
END $$;

-- Identical to 20261004_client_phases.sql section 4 except that each task's
-- details are copied.
CREATE OR REPLACE FUNCTION public.attach_package_to_engagement(
  p_coach_client_id  uuid,
  p_package_id       uuid,
  p_coach_profile_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_pkg_name      TEXT;
  v_pkg_discount  INTEGER;
  v_engagement_id uuid;
  v_deliv         RECORD;
  v_new_deliv_id  uuid;
  v_act           RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM coach_clients
    WHERE id = p_coach_client_id AND coach_profile_id = p_coach_profile_id
  ) THEN
    RAISE EXCEPTION 'coach_client_not_found_or_wrong_coach';
  END IF;

  SELECT name, discount_cents
    INTO v_pkg_name, v_pkg_discount
    FROM coach_packages
   WHERE id = p_package_id AND coach_profile_id = p_coach_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_not_found_or_wrong_coach';
  END IF;

  INSERT INTO coach_client_engagements (coach_client_id, source_package_id, name, discount_cents)
  VALUES (p_coach_client_id, p_package_id, v_pkg_name, v_pkg_discount)
  RETURNING id INTO v_engagement_id;

  FOR v_deliv IN
    SELECT m.id AS milestone_id, m.name, m.fee_cents, m.category, m.time_estimate_days, m.phase_id,
           cpm.sort_order AS sort_order
      FROM coach_package_milestones cpm
      JOIN coach_milestones m ON m.id = cpm.milestone_id
     WHERE cpm.package_id = p_package_id
     ORDER BY cpm.sort_order, cpm.created_at
  LOOP
    INSERT INTO coach_client_engagement_deliverables
      (engagement_id, source_milestone_id, name, fee_cents, category, time_estimate_days, sort_order, phase_id)
    VALUES
      (v_engagement_id, v_deliv.milestone_id, v_deliv.name, v_deliv.fee_cents, v_deliv.category,
       v_deliv.time_estimate_days, v_deliv.sort_order, v_deliv.phase_id)
    RETURNING id INTO v_new_deliv_id;

    FOR v_act IN
      SELECT a.id AS activity_id, a.name, a.owner, a.sort_order, a.details
        FROM coach_milestone_activities a
       WHERE a.milestone_id = v_deliv.milestone_id
       ORDER BY a.sort_order, a.created_at
    LOOP
      INSERT INTO coach_client_engagement_activities
        (engagement_deliverable_id, source_activity_id, name, owner, sort_order, details)
      VALUES
        (v_new_deliv_id, v_act.activity_id, v_act.name, v_act.owner, v_act.sort_order, v_act.details);
    END LOOP;
  END LOOP;

  RETURN v_engagement_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.attach_package_to_engagement(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.attach_package_to_engagement(uuid, uuid, uuid)
  TO service_role;
