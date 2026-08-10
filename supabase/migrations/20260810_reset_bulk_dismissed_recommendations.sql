-- 20260810_reset_bulk_dismissed_recommendations.sql
--
-- Reset coach_job_recommendations.client_status from 'interested' back to 'new'.
--
-- WHY. Until today the tracker carried a text button labelled "Mark all seen".
-- It wrote client_status = 'interested' for EVERY unanswered recommendation in
-- one statement. The label promised to clear a notification; the write told the
-- coach the client was interested in every job in the list, including ones they
-- had never opened. That control has been removed (see
-- app/api/coach/my-recommendations/route.ts) and replaced by a per-job
-- Interested / Not interested box on the job detail page.
--
-- The rows it wrote are still there, and they are indistinguishable from real
-- answers. 'interested' could have come from:
--   - the per-job response buttons that existed until 2026-08-04, or
--   - the bulk "Mark all seen" write.
-- The column that would separate them, client_responded_at, was never set by
-- either path: 0 of 131 prod rows have it. The evidence needed to tell a real
-- answer from a bulk dismissal is exactly the evidence that was never recorded.
--
-- So this resets ALL of them. A false 'interested' tells a coach their client
-- wants something they never said they wanted, and asking again costs one
-- click. Measured on prod 2026-08-10 before writing this: 25 rows affected.
--
-- ONE-WAY. There is no undo: after this runs, a genuine 'interested' from
-- before 2026-08-04 is indistinguishable from one that was never given, because
-- both are 'new'. That is accepted — see above for why the alternative is worse.

-- ── NOT TOUCHED, and this is the point of the WHERE clause ──
--
--   'applying'    (33 on prod) — only ever written by a deliberate control, and
--                 it also moves the linked application to 'applied'. A real act.
--   'not_for_me'  (13 on prod) — "Mark all seen" could not produce this value.
--                 It only ever wrote 'interested'. So every one of these is a
--                 real decline.
--   'applied' / 'archived' — same reasoning; never bulk-written.
--
-- Only 'interested' is ambiguous, so only 'interested' is reset.

UPDATE public.coach_job_recommendations
   SET client_status = 'new',
       updated_at    = now()
 WHERE client_status = 'interested'
   AND client_responded_at IS NULL;

-- The client_responded_at IS NULL guard is belt-and-braces rather than a
-- filter: nothing has ever written that column, so today it excludes nothing.
-- It is here so that re-running this migration after the new response box has
-- been in use CANNOT wipe a real answer — those rows will have a timestamp.

-- DEV:  applied 2026-08-10.
-- PROD: pending. Run AFTER the code deploy, not before: between this migration
-- and the deploy, the old banner would count these rows as 'new' and offer
-- "Mark all seen" again, which would write them straight back to 'interested'.
