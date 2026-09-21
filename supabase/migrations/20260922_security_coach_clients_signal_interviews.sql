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
--    The USING clause is unchanged, so every read that worked still works.
--
-- 2. signal_interviews had RLS off: any signed-in user could read every
--    client's interviews. How it is used today: the owner reads and writes their
--    own rows through service-role routes (/api/interviews, /api/applications,
--    account delete), coach routes read through the service role, and one route
--    reads it with the caller's JWT (the coach workbook view). The policies
--    below cover exactly that: the owner does everything to their own rows, an
--    actively linked coach reads. No route relies on anon access.

-- ---------------------------------------------------------------------------
-- 1. coach_clients: read-only for signed-in callers
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "coaches_see_own_clients" ON public.coach_clients;

CREATE POLICY "coaches_see_own_clients"
  ON public.coach_clients FOR SELECT
  USING (
    coach_profile_id = (
      SELECT id FROM client_profiles
      WHERE user_id = auth.uid()
    )
    OR
    client_profile_id = (
      SELECT id FROM client_profiles
      WHERE user_id = auth.uid()
    )
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
  USING (profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid()))
  WITH CHECK (profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid()));

-- Any active link, any access level: every coach read of interviews today is a
-- "read", which resolveScope grants at view and above.
DROP POLICY IF EXISTS signal_interviews_coach_select ON public.signal_interviews;
CREATE POLICY signal_interviews_coach_select
  ON public.signal_interviews FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM coach_clients cc
    WHERE cc.client_profile_id = signal_interviews.profile_id
      AND cc.coach_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid())
      AND cc.status = 'active'
  ));

REVOKE ALL ON public.signal_interviews FROM anon;

NOTIFY pgrst, 'reload schema';
