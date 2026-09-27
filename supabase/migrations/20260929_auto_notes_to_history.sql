-- ═══════════════════════════════════════════════════
-- "SIGNAL invite sent" and "Account created" leave Notes — 2026-09-29
-- ═══════════════════════════════════════════════════
--
-- IN PLAIN ENGLISH
--
-- Both of these were written to the Notes feed AND logged to History, so every
-- invite and every account creation appeared twice. The copy in Notes sat among
-- a coach's own writing, in the same typeface, with a coach's name on it, and a
-- reader could not tell what a colleague decided from what the software did.
--
-- Notes is what a person chose to write down. This is not. The code stopped
-- writing them in the same change (three routes: clients/[clientId]/send-invite,
-- coach-clients/[id]/send-invite, coach-clients/[id]/setup-account).
--
-- THE NOTES ARE DELETED, NOT MOVED, because the History event already exists.
-- Moving them would double the timeline instead of the feed.
--
-- EXCEPT WHERE IT DOES NOT. Of 37 "SIGNAL invite sent" notes on production, 36
-- have a matching invite_sent event and ONE does not: Alexander Nachman,
-- 1 July 2026, which predates the event logging on that route. Deleting that one
-- would destroy the only record that the invite was ever sent. So step 1
-- backfills an event from the note first, carrying its time and its author, and
-- step 2 then deletes only notes that provably have one. Nothing is lost.
--
-- MATCHED ON THE EXACT BODY. Both strings are written by one line of code each
-- and have never varied. A LIKE would also catch a coach who typed something
-- similar into a real note, and deleting a coach's own writing is the one
-- outcome this must not have.
--
-- RE-RUNNABLE. Step 1 skips a relationship that already has the event; step 2
-- only deletes what step 1 guaranteed. A second pass changes nothing.
--
-- Reversibility: the notes can be rebuilt from the events.
--   INSERT INTO coach_client_notes (coach_client_id, coach_profile_id,
--          client_profile_id, type, body, priority, created_at)
--   SELECT e.coach_client_id, e.actor_profile_id, cc.client_profile_id, 'other',
--          CASE e.event_type WHEN 'invite_sent' THEN 'SIGNAL invite sent'
--                            ELSE 'Account created' END,
--          NULL, e.created_at
--   FROM coach_client_events e
--   JOIN coach_clients cc ON cc.id = e.coach_client_id
--   WHERE e.event_type IN ('invite_sent', 'account_created');

BEGIN;

-- 1. Backfill the event for any note that has none, so nothing is deleted into
--    nothing. created_at and the author come from the note: stamping these with
--    today would claim every invite was sent on the day of the deploy.
INSERT INTO public.coach_client_events (coach_client_id, event_type, actor_profile_id, context, created_at)
SELECT
  n.coach_client_id,
  CASE n.body WHEN 'SIGNAL invite sent' THEN 'invite_sent' ELSE 'account_created' END,
  n.coach_profile_id,
  jsonb_build_object('backfilled_from_note', n.id),
  n.created_at
FROM public.coach_client_notes n
WHERE n.type = 'other'
  AND n.deleted_at IS NULL
  AND n.body IN ('SIGNAL invite sent', 'Account created')
  AND NOT EXISTS (
    SELECT 1 FROM public.coach_client_events e
    WHERE e.coach_client_id = n.coach_client_id
      AND e.event_type = CASE n.body WHEN 'SIGNAL invite sent' THEN 'invite_sent' ELSE 'account_created' END
  );

-- 2. Delete the duplicate notes. The EXISTS is the safety: a note whose event
--    did not land above is left alone rather than deleted into nothing.
DELETE FROM public.coach_client_notes n
WHERE n.type = 'other'
  AND n.deleted_at IS NULL
  AND n.body IN ('SIGNAL invite sent', 'Account created')
  AND EXISTS (
    SELECT 1 FROM public.coach_client_events e
    WHERE e.coach_client_id = n.coach_client_id
      AND e.event_type = CASE n.body WHEN 'SIGNAL invite sent' THEN 'invite_sent' ELSE 'account_created' END
  );

COMMIT;

-- Verification, to run straight after:
--   SELECT count(*) FROM coach_client_notes
--    WHERE type='other' AND deleted_at IS NULL
--      AND body IN ('SIGNAL invite sent','Account created');            -- expect 0
--   SELECT event_type, count(*) FROM coach_client_events
--    WHERE event_type IN ('invite_sent','account_created') GROUP BY 1;  -- expect >= the old note counts

NOTIFY pgrst, 'reload schema';
