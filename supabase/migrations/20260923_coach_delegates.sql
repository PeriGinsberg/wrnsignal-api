-- 20260923_coach_delegates.sql
-- A DELEGATE coach works inside another coach's practice.
--
-- The delegate has no clients of her own: she reaches the principal's clients,
-- at whatever level the principal holds, and every row she writes still carries
-- HER profile id, so the feed shows who did what. One-way by construction: the
-- row says nothing about the principal's access to the delegate's clients.
--
-- ONE IDEA, ONE PLACE: coach_acting_ids() answers "which coaches am I allowed to
-- act as" (myself, plus every principal I am an active delegate of). Access
-- checks change from "coach_profile_id = me" to "coach_profile_id = ANY(acting)",
-- in SQL policies here and in resolveScope on the route side. Nothing else about
-- the access model moves: the coach_clients row is still what grants access, and
-- access_level still decides read vs write.

CREATE TABLE IF NOT EXISTS public.coach_delegates (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Whose practice this is. The delegate acts inside it.
  principal_coach_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  delegate_coach_profile_id  uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  status                     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by                 uuid REFERENCES public.client_profiles(id),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_delegates_not_self CHECK (principal_coach_profile_id <> delegate_coach_profile_id),
  UNIQUE (principal_coach_profile_id, delegate_coach_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_coach_delegates_delegate
  ON public.coach_delegates (delegate_coach_profile_id, status);

-- Who created a coach_clients row, when that is not its coach. A delegate's new
-- client joins the PRINCIPAL's roster (coach_profile_id = principal) and this
-- records that the delegate did it.
ALTER TABLE public.coach_clients ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.client_profiles(id);

-- ---------------------------------------------------------------------------
-- Which coaches may I act as
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.coach_acting_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(ARRAY(
    SELECT current_profile_id()
    WHERE current_profile_id() IS NOT NULL
    UNION
    SELECT d.principal_coach_profile_id
    FROM coach_delegates d
    WHERE d.delegate_coach_profile_id = current_profile_id()
      AND d.status = 'active'
  ), ARRAY[]::uuid[])
$$;

REVOKE ALL ON FUNCTION public.coach_acting_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_acting_ids() TO authenticated;

-- ---------------------------------------------------------------------------
-- The three policy paths that decide what a coach can reach
-- ---------------------------------------------------------------------------

-- 1. Workbooks: full access, now also via a principal.
CREATE OR REPLACE FUNCTION public.wb_is_full_coach(p_client uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM coach_clients cc
    WHERE cc.client_profile_id = p_client
      AND cc.coach_profile_id = ANY (coach_acting_ids())
      AND cc.status = 'active'
      AND cc.access_level = 'full'
  )
$$;

-- 2. coach_clients: a delegate reads the principal's links (resolveScope runs
--    this read with the caller's JWT). Still read-only for everyone.
DROP POLICY IF EXISTS "coaches_see_own_clients" ON public.coach_clients;
CREATE POLICY "coaches_see_own_clients"
  ON public.coach_clients FOR SELECT
  USING (
    coach_profile_id = ANY (coach_acting_ids())
    OR client_profile_id = public.current_profile_id()
  );

-- 3. signal_interviews: the coach read, same widening.
DROP POLICY IF EXISTS signal_interviews_coach_select ON public.signal_interviews;
CREATE POLICY signal_interviews_coach_select
  ON public.signal_interviews FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM coach_clients cc
    WHERE cc.client_profile_id = signal_interviews.profile_id
      AND cc.coach_profile_id = ANY (coach_acting_ids())
      AND cc.status = 'active'
  ));

-- ---------------------------------------------------------------------------
-- coach_delegates itself: readable by both sides, written by the service role
-- only (there is no UI for it yet, and a delegate must never grant herself one).
-- ---------------------------------------------------------------------------

ALTER TABLE public.coach_delegates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coach_delegates_select ON public.coach_delegates;
CREATE POLICY coach_delegates_select
  ON public.coach_delegates FOR SELECT
  USING (
    principal_coach_profile_id = public.current_profile_id()
    OR delegate_coach_profile_id = public.current_profile_id()
  );

GRANT SELECT ON public.coach_delegates TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.coach_delegates FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
