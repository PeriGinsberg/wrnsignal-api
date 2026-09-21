-- 20260922_security_coach_clients_signal_interviews.sql
-- Two holes reachable with the public anon key plus any signed-in user's JWT,
-- through Supabase REST directly (no API route involved).
--
-- 1. coach_clients: coaches_see_own_clients was FOR ALL with no WITH CHECK, and
--    `authenticated` holds UPDATE/INSERT/DELETE on the table. A view-level coach
--    could PATCH their own row to access_level = 'full' (which the workbook
--    policies trust), a client could revoke or rewrite their own link, and
--    either could insert link rows. Every write in the app goes through the
--    service role (create-client, invites, accept-invite, collaborators,
--    prospects), which bypasses RLS, so read-only is all the policy needs.
--    The USING clause means the same thing (the caller's own links), so every
--    read that worked still works, and in prod reads now work at all.
--
-- 2. signal_interviews: in dev RLS was off, so any signed-in user could read
--    every client's interviews; in prod RLS was on with no policies, so nobody
--    but the service role could read any. How it is used today: the owner reads and writes their
--    own rows through service-role routes (/api/interviews, /api/applications,
--    account delete), coach routes read through the service role, and one route
--    reads it with the caller's JWT (the coach workbook view). The policies
--    below cover exactly that: the owner does everything to their own rows, an
--    actively linked coach reads. No route relies on anon access.
--
-- WHO IS CALLING: current_profile_id(), not an inline client_profiles lookup.
-- Prod has RLS ON for client_profiles with no policies (dev has it off), so an
-- inline `SELECT id FROM client_profiles WHERE user_id = auth.uid()` inside a
-- policy returns nothing for every signed-in caller in prod. The rehearsal
-- against prod showed it: under the old inline form nobody could read even
-- their own rows, and a coach could not read their own coach_clients links,
-- which the workbook routes need (resolveScope reads coach_clients with the
-- caller's JWT). A SECURITY DEFINER helper runs as the table owner, which
-- bypasses client_profiles RLS in both environments.

CREATE OR REPLACE FUNCTION public.current_profile_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM client_profiles WHERE user_id = auth.uid() LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.current_profile_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_profile_id() TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. coach_clients: read-only for signed-in callers
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "coaches_see_own_clients" ON public.coach_clients;

CREATE POLICY "coaches_see_own_clients"
  ON public.coach_clients FOR SELECT
  USING (
    coach_profile_id = public.current_profile_id()
    OR client_profile_id = public.current_profile_id()
  );

-- Belt and braces: with no write policy RLS already refuses, but the grants
-- should say the same thing the policy does.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.coach_clients FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. signal_interviews: RLS on
-- ---------------------------------------------------------------------------

ALTER TABLE public.signal_interviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signal_interviews_owner_all ON public.signal_interviews;
CREATE POLICY signal_interviews_owner_all
  ON public.signal_interviews FOR ALL
  USING (profile_id = public.current_profile_id())
  WITH CHECK (profile_id = public.current_profile_id());

-- Any active link, any access level: every coach read of interviews today is a
-- "read", which resolveScope grants at view and above.
DROP POLICY IF EXISTS signal_interviews_coach_select ON public.signal_interviews;
CREATE POLICY signal_interviews_coach_select
  ON public.signal_interviews FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM coach_clients cc
    WHERE cc.client_profile_id = signal_interviews.profile_id
      AND cc.coach_profile_id = public.current_profile_id()
      AND cc.status = 'active'
  ));

REVOKE ALL ON public.signal_interviews FROM anon;

NOTIFY pgrst, 'reload schema';
