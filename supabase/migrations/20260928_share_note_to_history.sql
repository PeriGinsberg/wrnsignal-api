-- ═══════════════════════════════════════════════════
-- "Networking plan shared with client" moves to History — 2026-09-28
-- ═══════════════════════════════════════════════════
--
-- IN PLAIN ENGLISH
--
-- The Notes tab is what a coach chose to write down. The History tab is what
-- happened. Sharing a networking plan wrote itself into Notes, where it sat
-- between session recaps and a coach's own observations looking like something
-- a person had typed.
--
-- This moves the ones already written. The code stops writing new ones in the
-- same change: see noteShareOnClientRecord in lib/networking-plan/job.ts, which
-- now calls logCoachClientEvent instead.
--
-- WHAT IS PRESERVED. created_at is carried across, not defaulted, because the
-- whole value of an audit line is when it happened; a migration that stamped
-- them all with today would say every plan was shared on the day of the deploy.
-- The note's coach_profile_id becomes the event's actor, so the line still says
-- who shared it.
--
-- MATCHED ON THE EXACT BODY, and on type = 'other'. The string is written by
-- one line of code and has never varied. A LIKE would also catch a coach who
-- typed something similar into a real note, and deleting a coach's own writing
-- is the one outcome this must not have.
--
-- RE-RUNNABLE. The insert skips any relationship that already has an event at
-- the same instant, so a second pass moves nothing twice. The delete then only
-- removes notes that have a matching event, so a note whose insert failed is
-- still there to try again rather than gone.
--
-- Reversibility: the notes can be rebuilt from the events.
--   INSERT INTO coach_client_notes (coach_client_id, coach_profile_id,
--          client_profile_id, type, body, created_at)
--   SELECT e.coach_client_id, e.actor_profile_id, cc.client_profile_id,
--          'other', 'Networking plan shared with client', e.created_at
--   FROM coach_client_events e
--   JOIN coach_clients cc ON cc.id = e.coach_client_id
--   WHERE e.event_type = 'networking_plan_shared';

BEGIN;

-- 1. Copy each note across as an event, keeping its time and its author.
INSERT INTO public.coach_client_events (coach_client_id, event_type, actor_profile_id, context, created_at)
SELECT
  n.coach_client_id,
  'networking_plan_shared',
  n.coach_profile_id,
  jsonb_build_object('migrated_from_note', n.id),
  n.created_at
FROM public.coach_client_notes n
WHERE n.type = 'other'
  AND n.body = 'Networking plan shared with client'
  AND n.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.coach_client_events e
    WHERE e.coach_client_id = n.coach_client_id
      AND e.event_type = 'networking_plan_shared'
      AND e.created_at = n.created_at
  );

-- 2. Remove the notes that now have an event. The EXISTS is the safety: a note
--    whose insert above did not land is left alone rather than deleted into
--    nothing.
DELETE FROM public.coach_client_notes n
WHERE n.type = 'other'
  AND n.body = 'Networking plan shared with client'
  AND n.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.coach_client_events e
    WHERE e.coach_client_id = n.coach_client_id
      AND e.event_type = 'networking_plan_shared'
      AND e.created_at = n.created_at
  );

COMMIT;

-- Verification, to run straight after:
--   SELECT count(*) FROM coach_client_notes
--    WHERE body = 'Networking plan shared with client' AND deleted_at IS NULL;   -- expect 0
--   SELECT count(*) FROM coach_client_events WHERE event_type = 'networking_plan_shared';

NOTIFY pgrst, 'reload schema';
