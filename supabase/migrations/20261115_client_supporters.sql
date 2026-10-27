-- 20261115_client_supporters.sql
-- SUPPORTERS: someone the client invites (a parent, a partner, a mentor) to
-- follow the search and suggest jobs.
--
-- A supporter is NOT a client and has NO client_profiles row. client_profiles
-- means "a client" everywhere (rosters, JobFit, billing, coach lists), so a
-- supporter is a login plus a row here, and every existing route keeps failing
-- closed for them ("Profile not found"). They reach a client only through the
-- /api/supporter routes, which resolve lib/collab/supporter.ts.
--
-- WHAT THIS CREATES
--   feature_modes               one row per gated feature: off | free | paid
--   feature_entitlements        per-client grants, read only when a mode is 'paid'
--   client_supporters           the invite and the grant, max 2 live per client
--   supporter_job_suggestions   jobs a supporter added, until the client acts
--   signal_applications.added_by_role / added_by_profile_id / added_by_supporter_id
--   is_supporter_login()        and RESTRICTIVE policies on the coach-only tables
--
-- WHAT THIS REMOVES
--   'coach_recommended' from the application_status CHECK. Nothing writes it:
--   recommend-job saves coach jobs as 'saved', and prod held 0 rows with the
--   value on 2026-10-27. Who added a job is now a column, not a status.
--
-- RLS. Every route uses the service role, which bypasses RLS; the real wall is
-- the route layer. The policies here are a backstop for a stray signed-in
-- client. Prod (probed 2026-10-27) has RLS ON with 0 policies on
-- client_profiles, signal_applications, jobfit_runs and coverletter_runs, so a
-- signed-in caller already reads nothing from them: they are left alone. The
-- coach-only tables DO carry permissive policies, so those get a restrictive
-- one that no supporter login can pass.
--
-- Apply by hand in the SQL Editor. Verification queries at the bottom.

-- ---------------------------------------------------------------------------
-- 0. Guard: nothing may still carry the status being removed
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.signal_applications WHERE application_status = 'coach_recommended') THEN
    RAISE EXCEPTION 'signal_applications still has coach_recommended rows; move them to saved first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Plan flag
-- ---------------------------------------------------------------------------

-- One row per gated feature. 'off' blocks everyone (live supporters pause,
-- nothing is deleted), 'free' lets every client in, 'paid' needs an
-- entitlement row. Flipping a mode is an UPDATE, not a deploy.
CREATE TABLE IF NOT EXISTS public.feature_modes (
  feature    text PRIMARY KEY,
  mode       text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'free', 'paid')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.feature_modes (feature, mode) VALUES ('supporters', 'off')
ON CONFLICT (feature) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.feature_entitlements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  feature           text NOT NULL REFERENCES public.feature_modes(feature),
  source            text NOT NULL CHECK (source IN ('purchase', 'coach', 'comp')),
  granted_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_feature_entitlements_live
  ON public.feature_entitlements (client_profile_id, feature)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Supporters
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.client_supporters (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id     uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  -- Lowercased. The login that accepts must carry this exact email.
  email                 text NOT NULL CHECK (email = lower(email)),
  -- What the client calls them. The "Added by" tag reads it, so it survives a revoke.
  display_name          text NOT NULL,
  -- auth.users.id, set on accept. No FK: auth is its own schema.
  supporter_user_id     uuid,
  status                text NOT NULL DEFAULT 'invited'
                        CHECK (status IN ('invited', 'active', 'revoked', 'expired')),
  -- The cap. Two slots, and a live row holds one (see the unique index below).
  slot                  smallint NOT NULL CHECK (slot IN (1, 2)),
  invited_by_profile_id uuid NOT NULL REFERENCES public.client_profiles(id),
  -- SHA-256 of the emailed token, hex. The token itself is never stored.
  invite_token_hash     text UNIQUE,
  invite_expires_at     timestamptz,
  invite_sent_at        timestamptz,
  accepted_at           timestamptz,
  revoked_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_supporters_active_has_login
    CHECK (status <> 'active' OR supporter_user_id IS NOT NULL)
);

-- MAX 2 LIVE SUPPORTERS, race-safe with no trigger: two inserts for the same
-- slot cannot both commit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_supporters_live_slot
  ON public.client_supporters (client_profile_id, slot)
  WHERE status IN ('invited', 'active');

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_supporters_live_email
  ON public.client_supporters (client_profile_id, email)
  WHERE status IN ('invited', 'active');

CREATE INDEX IF NOT EXISTS idx_client_supporters_login
  ON public.client_supporters (supporter_user_id, status);

CREATE OR REPLACE TRIGGER trg_client_supporters_set_updated_at
  BEFORE UPDATE ON public.client_supporters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Suggestions
-- ---------------------------------------------------------------------------

-- A supporter's job lives HERE until the client accepts it, and only then
-- becomes a signal_applications row. 26 files read signal_applications (coach
-- home, metrics, engagement heuristics...); keeping pending jobs out of that
-- table means none of them can count a job the client never took.
CREATE TABLE IF NOT EXISTS public.supporter_job_suggestions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  supporter_id      uuid NOT NULL REFERENCES public.client_supporters(id) ON DELETE CASCADE,
  company_name      text NOT NULL CHECK (btrim(company_name) <> ''),
  job_title         text NOT NULL CHECK (btrim(job_title) <> ''),
  job_url           text NOT NULL DEFAULT '',
  location          text NOT NULL DEFAULT '',
  note              text NOT NULL DEFAULT '',
  -- pending: the supporter may still edit or delete it. accepted / dismissed:
  -- the client acted, and it is read-only for everyone.
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  application_id    uuid REFERENCES public.signal_applications(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supporter_job_suggestions_decided
    CHECK ((status = 'pending') = (decided_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_supporter_job_suggestions_client
  ON public.supporter_job_suggestions (client_profile_id, status, created_at DESC);

CREATE OR REPLACE TRIGGER trg_supporter_job_suggestions_set_updated_at
  BEFORE UPDATE ON public.supporter_job_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Who added each tracker row
-- ---------------------------------------------------------------------------

-- 'client' needs no id: the row's own profile_id is the client. The default
-- covers every client insert path without touching it.
ALTER TABLE public.signal_applications
  ADD COLUMN IF NOT EXISTS added_by_role text NOT NULL DEFAULT 'client'
    CHECK (added_by_role IN ('client', 'coach', 'supporter')),
  ADD COLUMN IF NOT EXISTS added_by_profile_id uuid REFERENCES public.client_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS added_by_supporter_id uuid REFERENCES public.client_supporters(id) ON DELETE SET NULL;

-- Coach-added rows: the only signal before this column was a recommendation
-- pointing at the application.
UPDATE public.signal_applications a
   SET added_by_role = 'coach',
       added_by_profile_id = r.coach_profile_id
  FROM public.coach_job_recommendations r
 WHERE r.application_id = a.id
   AND a.added_by_role = 'client';

ALTER TABLE public.signal_applications
  DROP CONSTRAINT IF EXISTS signal_applications_application_status_check;
ALTER TABLE public.signal_applications
  ADD CONSTRAINT signal_applications_application_status_check
  CHECK (application_status IN ('saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'));

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------

-- New tables: service role only, like posting_matches and lane_results.
ALTER TABLE public.feature_modes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_entitlements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_supporters         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supporter_job_suggestions ENABLE ROW LEVEL SECURITY;

-- Any login that has EVER been a supporter, revoked included. SECURITY DEFINER
-- so it reads client_supporters past its own RLS.
CREATE OR REPLACE FUNCTION public.is_supporter_login() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM client_supporters WHERE supporter_user_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION public.is_supporter_login() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_supporter_login() TO authenticated;

-- RESTRICTIVE: ANDed with the existing permissive policies, so it can only
-- take access away. A supporter has no profile, so the permissive policies
-- already give them nothing; this keeps it that way if one is ever created.
DROP POLICY IF EXISTS "no_supporters" ON public.coaching_notes;
CREATE POLICY "no_supporters" ON public.coaching_notes
  AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.is_supporter_login());

DROP POLICY IF EXISTS "no_supporters" ON public.coach_annotations;
CREATE POLICY "no_supporters" ON public.coach_annotations
  AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.is_supporter_login());

DROP POLICY IF EXISTS "no_supporters" ON public.coach_client_notes;
CREATE POLICY "no_supporters" ON public.coach_client_notes
  AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.is_supporter_login());

DROP POLICY IF EXISTS "no_supporters" ON public.coach_job_recommendations;
CREATE POLICY "no_supporters" ON public.coach_job_recommendations
  AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.is_supporter_login());

DROP POLICY IF EXISTS "no_supporters" ON public.coach_recommendation_responses;
CREATE POLICY "no_supporters" ON public.coach_recommendation_responses
  AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.is_supporter_login());

-- ---------------------------------------------------------------------------
-- Verify (run after applying)
-- ---------------------------------------------------------------------------
-- SELECT feature, mode FROM feature_modes;                                   -- supporters | off
-- SELECT added_by_role, count(*) FROM signal_applications GROUP BY 1;        -- coach = rows with a recommendation
-- SELECT count(*) FROM signal_applications a JOIN coach_job_recommendations r
--   ON r.application_id = a.id WHERE a.added_by_role <> 'coach';             -- 0
-- SELECT tablename, policyname, permissive FROM pg_policies
--  WHERE policyname = 'no_supporters' ORDER BY 1;                            -- 5 rows, RESTRICTIVE
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname IN
--   ('feature_modes','feature_entitlements','client_supporters','supporter_job_suggestions'); -- all true
--
-- To turn it on for testing on dev:
--   UPDATE feature_modes SET mode = 'free', updated_at = now() WHERE feature = 'supporters';
