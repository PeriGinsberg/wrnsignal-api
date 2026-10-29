-- Nightly pipeline: one row per step per night, and cost alerts sent once.
--
-- APPLY BY HAND in the Supabase SQL Editor (prod and dev), before the code that
-- writes these tables is promoted. Idempotent.
--
-- pipeline_runs is what the watchdog reads: a step with no row for tonight did
-- not run, which is the "skipped" alert. Costs are per step so the Monday
-- email can break them out; the month-to-date total is read from
-- enrichment_runs and match_runs instead, so manual runs count too.
--
-- cost_alerts makes each pace alert fire once per period: without it, a month
-- on pace for $120 would send the same email every night until the 1st.

CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The UTC date the night's 03:00 sweep starts on. Every step of one night shares it.
  night date NOT NULL,
  step text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  triggered_by text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- What the step worked through: runs (ATS), searches (Google Jobs), postings
  -- enriched, judge calls, links checked.
  units integer NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  -- Google Jobs only: searches this step spent.
  searches integer NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  CONSTRAINT pipeline_runs_step_valid CHECK (step IN ('ats_grnhse', 'ats_smartrecruiters', 'google_jobs', 'enrich', 'match', 'link_check')),
  -- capped: stopped at its cap or time limit with work left; the rest waits for the next run.
  CONSTRAINT pipeline_runs_status_valid CHECK (status IN ('running', 'ok', 'capped', 'error')),
  CONSTRAINT pipeline_runs_error_shape CHECK ((status = 'error') = (error IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS pipeline_runs_night_step ON public.pipeline_runs (night, step);
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pipeline_runs FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.cost_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'spend' (calendar month) or 'searches' (SearchApi billing period).
  kind text NOT NULL,
  -- The month ("2026-11") or billing period start ("2026-10-25") it was sent for.
  period text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT cost_alerts_kind_valid CHECK (kind IN ('spend', 'searches')),
  CONSTRAINT cost_alerts_once UNIQUE (kind, period)
);
ALTER TABLE public.cost_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cost_alerts FROM anon, authenticated;

-- When a client's searches last changed: target roles, markets, or being
-- switched (back) on. Google Jobs searches that client's pairs first when this
-- is newer than a pair's last search. Not updated_at: that moves on any edit,
-- notes or a review, and would send every reviewed client's pairs to the front.
-- Backfilled to created_at, so existing clients are not all "changed" tonight.
-- (The backfill UPDATE also moves updated_at once, through the touch trigger.)
ALTER TABLE public.client_match_criteria ADD COLUMN IF NOT EXISTS targets_changed_at timestamptz;
UPDATE public.client_match_criteria SET targets_changed_at = created_at WHERE targets_changed_at IS NULL;
ALTER TABLE public.client_match_criteria ALTER COLUMN targets_changed_at SET DEFAULT now();
ALTER TABLE public.client_match_criteria ALTER COLUMN targets_changed_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.client_match_criteria_targets_touch()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.target_roles IS DISTINCT FROM OLD.target_roles
     OR NEW.markets IS DISTINCT FROM OLD.markets
     OR (NEW.active AND NOT OLD.active) THEN
    NEW.targets_changed_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS client_match_criteria_targets_touch ON public.client_match_criteria;
CREATE TRIGGER client_match_criteria_targets_touch BEFORE UPDATE ON public.client_match_criteria
  FOR EACH ROW EXECUTE FUNCTION public.client_match_criteria_targets_touch();

-- Verify:
--   SELECT to_regclass('public.pipeline_runs') IS NOT NULL AS pipeline_runs,
--          to_regclass('public.cost_alerts') IS NOT NULL AS cost_alerts,
--          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
--                  AND table_name = 'client_match_criteria' AND column_name = 'targets_changed_at') AS targets_changed_at,
--          EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'client_match_criteria_targets_touch') AS targets_trigger;
