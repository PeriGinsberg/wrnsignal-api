-- 20260924_workbooks_coach_insert.sql
-- A COACH CAN NOW CREATE A WORKBOOK FROM THE WORKBOOKS TAB.
--
-- This deliberately reverses a decision written into 20260921_workbooks_v1.sql:
-- "Creation is the operator script (service role)". That was right while a
-- workbook could only come from a content file on someone's laptop. Session
-- templates live in the repo now (lib/workbook/templates.ts) and the coach
-- picks one, so creation belongs to the coach, under RLS, like every other
-- workbook operation.
--
-- The WITH CHECK states the whole rule once, so the route stays a plain insert
-- and no route can forget a clause:
--   1. full access to this client, which wb_is_full_coach already answers
--      through coach_acting_ids(), so a DELEGATE passes on the principal's row
--   2. created_by is the CALLER. A coach cannot file a workbook under someone
--      else's name, which is what keeps the feed's attribution honest.
--   3. coach_client_id is a real, active, full-access link for THIS client and
--      for a coach the caller may act as. Without this the row could hang off
--      an unrelated relationship and follow the wrong practice.
--
-- Still no UPDATE or DELETE policy: status changes go through the send
-- functions, and content stays frozen once written.

DROP POLICY IF EXISTS workbooks_coach_insert ON public.workbooks;
CREATE POLICY workbooks_coach_insert
  ON public.workbooks FOR INSERT
  WITH CHECK (
    wb_is_full_coach(client_profile_id)
    AND created_by = public.current_profile_id()
    AND EXISTS (
      SELECT 1 FROM public.coach_clients cc
      WHERE cc.id = workbooks.coach_client_id
        AND cc.client_profile_id = workbooks.client_profile_id
        AND cc.coach_profile_id = ANY (public.coach_acting_ids())
        AND cc.status = 'active'
        AND cc.access_level = 'full'
    )
  );

NOTIFY pgrst, 'reload schema';
