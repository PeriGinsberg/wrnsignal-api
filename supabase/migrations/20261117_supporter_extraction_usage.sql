-- 20261117_supporter_extraction_usage.sql
-- A daily count of job auto-fills per supporter login.
--
-- The supporter suggestion form can fill itself from a job link or a pasted
-- description (POST /api/supporter/clients/[clientId]/extract-job), using the
-- same parse code as JobFit. Each fill can cost an AI call, so it is capped
-- per supporter login per day. Every attempt counts, a failed fetch included,
-- because a blocked page can still have cost a call.
--
-- Keyed on the login, not the client_supporters row: one person supporting
-- two clients gets one allowance, not two.
--
-- The day is America/New_York, so the allowance resets at midnight Eastern.
--
-- Requires 20261115_client_supporters.sql. Additive; safe to run twice.

CREATE TABLE IF NOT EXISTS public.supporter_extraction_usage (
  supporter_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  used_on           date NOT NULL,
  used              integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supporter_user_id, used_on)
);

-- Server only, like the other supporter tables: RLS on, no policies, so only
-- the service role reads or writes it.
ALTER TABLE public.supporter_extraction_usage ENABLE ROW LEVEL SECURITY;

-- Takes one fill from today's allowance, atomically. Returns today's count
-- after the take, or NULL when the allowance is already used up (nothing is
-- taken then). One statement, so two fills at once cannot both take the last.
CREATE OR REPLACE FUNCTION public.take_supporter_extraction(p_user uuid, p_limit integer)
RETURNS integer
LANGUAGE sql VOLATILE SET search_path = public AS $$
  INSERT INTO public.supporter_extraction_usage AS u (supporter_user_id, used_on, used)
  VALUES (p_user, (now() AT TIME ZONE 'America/New_York')::date, 1)
  ON CONFLICT (supporter_user_id, used_on)
  DO UPDATE SET used = u.used + 1, updated_at = now()
    WHERE u.used < p_limit
  RETURNING used;
$$;
REVOKE ALL ON FUNCTION public.take_supporter_extraction(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_supporter_extraction(uuid, integer) TO service_role;

-- Verify:
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'supporter_extraction_usage';  -- true
-- SELECT proname FROM pg_proc WHERE proname = 'take_supporter_extraction';             -- 1 row
