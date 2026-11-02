-- 20261120_job_queue_learning.sql
-- Job Queue (3 of 4): what the coach's decisions teach the matcher.
--
-- coach_page_visits      "new since my last visit", per coach and page. The
--                        page reads previous_visit_at; each visit shifts
--                        last -> previous. (coach_clients.last_viewed_at is
--                        per client and means something else.)
-- client_match_criteria.judge_examples / examples_taken_at
--                        the weekly snapshot of the coach's decisions the judge
--                        sees for this client: up to 10 fits and 15 misses from
--                        the last 60 days. Part of criteria_hash, so a new
--                        snapshot re-judges the client once; the snapshot is
--                        rebuilt only for a client with a decision since the
--                        last one, so a quiet week re-judges nothing. NULL =
--                        no snapshot yet: the judge keeps reading the latest
--                        decisions as before, outside the hash.
-- criteria_proposals     the Monday proposals (Sonnet 5.5): one row per
--                        suggested edit, approved or rejected on the
--                        proposals page. An approved edit writes
--                        client_match_criteria; that night re-judges.
-- match_quality_weekly   per client per week: where fits and not-a-fits sat in
--                        the queue when decided, and how many of each in the
--                        top 20.
--
-- Requires 20261120_job_queue_matches.sql. Same file for dev and prod.
-- Additive; safe to run twice. One transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS public.coach_page_visits (
  coach_profile_id uuid NOT NULL REFERENCES public.client_profiles (id) ON DELETE CASCADE,
  page text NOT NULL,
  last_visit_at timestamptz NOT NULL DEFAULT now(),
  previous_visit_at timestamptz,
  PRIMARY KEY (coach_profile_id, page)
);
ALTER TABLE public.coach_page_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coach_page_visits FROM anon, authenticated;

ALTER TABLE public.client_match_criteria
  ADD COLUMN IF NOT EXISTS judge_examples jsonb,
  ADD COLUMN IF NOT EXISTS examples_taken_at timestamptz;
ALTER TABLE public.client_match_criteria DROP CONSTRAINT IF EXISTS client_match_criteria_examples_array;
ALTER TABLE public.client_match_criteria ADD CONSTRAINT client_match_criteria_examples_array
  CHECK (judge_examples IS NULL OR jsonb_typeof(judge_examples) = 'array');
COMMENT ON COLUMN public.client_match_criteria.judge_examples IS
  'Weekly snapshot of the coach''s Job Queue decisions shown to the judge: [{title, company, action, reason, note}], up to 10 push and 15 dismiss from the last 60 days. Part of criteria_hash. NULL = none taken yet.';

CREATE TABLE IF NOT EXISTS public.criteria_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles (id) ON DELETE CASCADE,
  week_of date NOT NULL,
  -- Which criteria field, and what to do to it.
  field text NOT NULL,
  op text NOT NULL,
  value jsonb NOT NULL,
  rationale text NOT NULL,
  -- The decisions behind it (posting_matches ids).
  evidence_match_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  status text NOT NULL DEFAULT 'pending',
  decided_at timestamptz,
  decided_by uuid REFERENCES public.client_profiles (id) ON DELETE SET NULL,
  model text NOT NULL,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT criteria_proposals_field_known CHECK (field IN (
    'target_roles', 'target_industries', 'excluded_industries', 'excluded_title_keywords', 'excluded_employers',
    'max_years_required', 'salary_floor', 'notes')),
  CONSTRAINT criteria_proposals_op_known CHECK (op IN ('add', 'remove', 'set')),
  CONSTRAINT criteria_proposals_status_known CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  CONSTRAINT criteria_proposals_decided_shape CHECK ((status IN ('approved', 'rejected')) = (decided_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS criteria_proposals_pending_idx ON public.criteria_proposals (client_profile_id, week_of DESC) WHERE status = 'pending';
ALTER TABLE public.criteria_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.criteria_proposals FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.match_quality_weekly (
  week_of date NOT NULL,
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles (id) ON DELETE CASCADE,
  fits integer NOT NULL DEFAULT 0,
  not_fits integer NOT NULL DEFAULT 0,
  -- Median of rank_at_action / queue_size_at_action, 0 = top of the queue.
  fit_median_rank_pct numeric(5, 4),
  not_fit_median_rank_pct numeric(5, 4),
  top20_fits integer NOT NULL DEFAULT 0,
  top20_not_fits integer NOT NULL DEFAULT 0,
  -- Not a fit reasons that week: {"wrong_function": 4, ...}
  reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
  criteria_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_of, client_profile_id)
);
ALTER TABLE public.match_quality_weekly ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_quality_weekly FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify (every row true):
-- SELECT 'coach_page_visits' AS check, to_regclass('public.coach_page_visits') IS NOT NULL AS ok
-- UNION ALL SELECT 'criteria_proposals', to_regclass('public.criteria_proposals') IS NOT NULL
-- UNION ALL SELECT 'match_quality_weekly', to_regclass('public.match_quality_weekly') IS NOT NULL
-- UNION ALL SELECT 'judge_examples column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_match_criteria' AND column_name = 'judge_examples')
-- UNION ALL SELECT 'no snapshots yet', NOT EXISTS (SELECT 1 FROM public.client_match_criteria WHERE judge_examples IS NOT NULL);
