-- 20261101_matching.sql
-- Phase 3 matching: per-client criteria, one match row per (client, posting),
-- a run log, and the ranked review queue.
--
-- Requires 20261031_postings_enrichment_prod.sql (or dev's 20261029 + 20261030)
-- and 20261027_posting_links.sql (the queue reads postings_canonical).
--
-- DESIGN (decided 2026-10-25)
--   * client_match_criteria replaces lane config as what matching reads. It is
--     edited from the client profile; graduation date, education status,
--     timeline and background are read from client_profiles itself, not copied.
--   * The launch queue is RANKED, not filtered: every posting that passes the
--     hard rules is shown, sorted by score, nothing hidden. A posting with no
--     description (SmartRecruiters today) passes the rules unjudged and sorts
--     after every scored row.
--   * Re-matching: lib/match/runMatching.ts hashes everything the rules and the
--     judge read (criteria, the profile fields, the judge prompt) into
--     criteria_hash, and the posting's description into description_md5. A row
--     whose hash differs from today's is re-evaluated; nothing else is.
--   * "New since last review": first_queued_at (when the posting first passed
--     this client's rules) is later than client_match_criteria.last_reviewed_at.
--     A posting that keeps passing after a re-match keeps its first_queued_at.
--   * The review decision uses lane_results' taxonomy unchanged, so the queue,
--     the dismissal counts and the Score handoff can move here in Phase 4.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Criteria
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_match_criteria (
  client_profile_id uuid PRIMARY KEY REFERENCES public.client_profiles (id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  -- [{ "name": "chicago", "states": ["il","in","wi"] }, ...]. Empty = anywhere.
  markets jsonb NOT NULL DEFAULT '[]'::jsonb,
  radius_miles integer,
  remote_ok boolean NOT NULL DEFAULT true,
  max_years_required integer,
  -- full_time, internship, part_time, contract, temporary
  job_types text[] NOT NULL DEFAULT '{}'::text[],
  salary_floor numeric(12, 2),
  salary_floor_period text,
  excluded_title_keywords text[] NOT NULL DEFAULT '{}'::text[],
  excluded_employers text[] NOT NULL DEFAULT '{}'::text[],
  -- Judgment only: never hard filters.
  target_roles text[] NOT NULL DEFAULT '{}'::text[],
  target_industries text[] NOT NULL DEFAULT '{}'::text[],
  excluded_industries text[] NOT NULL DEFAULT '{}'::text[],
  notes text,
  seeded_from_lane_id uuid REFERENCES public.search_lanes (id) ON DELETE SET NULL,
  -- Set when the coach finishes a review session; drives "new since last review".
  last_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_match_criteria_markets_array CHECK (jsonb_typeof(markets) = 'array'),
  CONSTRAINT client_match_criteria_radius CHECK (radius_miles IS NULL OR radius_miles > 0),
  CONSTRAINT client_match_criteria_years CHECK (max_years_required IS NULL OR max_years_required >= 0),
  CONSTRAINT client_match_criteria_job_types CHECK (job_types <@ ARRAY['full_time','internship','part_time','contract','temporary']::text[]),
  CONSTRAINT client_match_criteria_salary_floor CHECK (
    (salary_floor IS NULL AND salary_floor_period IS NULL)
    OR (salary_floor IS NOT NULL AND salary_floor >= 0 AND salary_floor_period IS NOT NULL AND salary_floor_period IN ('year', 'hour'))
  )
);
ALTER TABLE public.client_match_criteria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_match_criteria FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_match_criteria_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  NEW.created_at = OLD.created_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS client_match_criteria_touch ON public.client_match_criteria;
CREATE TRIGGER client_match_criteria_touch BEFORE UPDATE ON public.client_match_criteria
  FOR EACH ROW EXECUTE FUNCTION public.client_match_criteria_touch();

-- ---------------------------------------------------------------------------
-- 2. Run log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  triggered_by text NOT NULL,
  client_profile_id uuid REFERENCES public.client_profiles (id) ON DELETE SET NULL,
  model text NOT NULL,
  effort text,
  prompt_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  postings_scanned integer NOT NULL DEFAULT 0,
  evaluated integer NOT NULL DEFAULT 0,
  rule_failed integer NOT NULL DEFAULT 0,
  judged integer NOT NULL DEFAULT 0,
  unjudged_no_description integer NOT NULL DEFAULT 0,
  judge_errors integer NOT NULL DEFAULT 0,
  newly_queued integer NOT NULL DEFAULT 0,
  api_calls integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  cache_read_tokens bigint NOT NULL DEFAULT 0,
  cache_write_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  error text,
  CONSTRAINT match_runs_status_valid CHECK (status IN ('running', 'ok', 'error')),
  CONSTRAINT match_runs_error_shape CHECK ((status = 'error') = (error IS NOT NULL))
);
ALTER TABLE public.match_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_runs FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Matches
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.posting_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles (id) ON DELETE CASCADE,
  posting_id uuid NOT NULL REFERENCES public.postings (id) ON DELETE CASCADE,
  -- What was evaluated. A differing hash today = re-evaluate.
  criteria_hash text NOT NULL,
  description_md5 text,
  -- Hard rules. Empty = passed = in the queue.
  rule_failures text[] NOT NULL DEFAULT '{}'::text[],
  -- Judgment. NULL score with no error = not judged (no description to read).
  score smallint,
  judge_reason text,
  judge_evidence text,
  judge_error text,
  judged_at timestamptz,
  prompt_sha256 text,
  match_run_id uuid REFERENCES public.match_runs (id) ON DELETE SET NULL,
  -- First time this posting passed this client's rules. Kept across re-matches.
  first_queued_at timestamptz,
  -- The coach's decision: lane_results' taxonomy, unchanged.
  action text,
  dismiss_reason text,
  note text,
  actioned_at timestamptz,
  actioned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posting_matches_unique UNIQUE (client_profile_id, posting_id),
  CONSTRAINT posting_matches_rule_failures_known CHECK (rule_failures <@ ARRAY[
    'location','years','graduation','excluded_title','excluded_employer','salary','job_type']::text[]),
  CONSTRAINT posting_matches_score_range CHECK (score IS NULL OR (score BETWEEN 0 AND 100)),
  CONSTRAINT posting_matches_judged_shape CHECK (
    (score IS NULL AND judge_reason IS NULL AND judge_evidence IS NULL) OR (score IS NOT NULL AND judge_reason IS NOT NULL)
  ),
  CONSTRAINT posting_matches_action_valid CHECK (action IS NULL OR action IN ('push', 'dismiss', 'cleared')),
  CONSTRAINT posting_matches_action_time CHECK ((action IS NULL) = (actioned_at IS NULL)),
  CONSTRAINT posting_matches_dismiss_reason CHECK (
    -- IS NOT NULL first: "NULL IN (...)" is NULL, and a CHECK passes on NULL.
    (action = 'dismiss' AND dismiss_reason IS NOT NULL AND dismiss_reason IN ('too_senior', 'too_junior', 'wrong_function', 'wrong_industry', 'wrong_location',
                                               'right_employer_wrong_level', 'doesnt_meet_requirements', 'already_applied', 'other'))
    OR ((action IS NULL OR action IN ('push', 'cleared')) AND dismiss_reason IS NULL)
  )
);
ALTER TABLE public.posting_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.posting_matches FROM anon, authenticated;

-- first_queued_at is set here, not by callers, so a re-match can never reset it
-- and the "new" badge cannot be forged by a writer forgetting a column.
CREATE OR REPLACE FUNCTION public.posting_matches_touch()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.first_queued_at = CASE WHEN cardinality(NEW.rule_failures) = 0 THEN now() ELSE NULL END;
  ELSE
    NEW.created_at = OLD.created_at;
    NEW.updated_at = now();
    NEW.first_queued_at = coalesce(OLD.first_queued_at, CASE WHEN cardinality(NEW.rule_failures) = 0 THEN now() END);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS posting_matches_touch ON public.posting_matches;
CREATE TRIGGER posting_matches_touch BEFORE INSERT OR UPDATE ON public.posting_matches
  FOR EACH ROW EXECUTE FUNCTION public.posting_matches_touch();

CREATE INDEX IF NOT EXISTS posting_matches_queue_idx
  ON public.posting_matches (client_profile_id, score DESC NULLS LAST)
  WHERE cardinality(rule_failures) = 0 AND action IS NULL;
CREATE INDEX IF NOT EXISTS posting_matches_posting_idx ON public.posting_matches (posting_id);

-- ---------------------------------------------------------------------------
-- 4. The ranked queue
-- ---------------------------------------------------------------------------
-- Every unactioned posting that passes the client's rules and is still live
-- (seen on its source in the last 14 days), highest score first, unjudged last.
-- postings_canonical hides the secondary of a cross-source link.
CREATE OR REPLACE VIEW public.client_match_queue
WITH (security_invoker = true) AS
  SELECT
    m.client_profile_id,
    m.posting_id,
    m.score,
    m.judge_reason,
    m.judge_evidence,
    m.first_queued_at,
    (m.first_queued_at > coalesce(c.last_reviewed_at, '-infinity'::timestamptz)) AS is_new,
    p.source,
    coalesce(p.cleaned_title, p.title) AS title,
    p.company,
    p.location,
    p.apply_url,
    p.years_min, p.years_max, p.years_basis,
    p.salary_low, p.salary_high, p.salary_period,
    p.application_deadline,
    p.requirements_summary,
    p.posted_at,
    p.first_seen_at,
    p.last_seen_at,
    row_number() OVER (PARTITION BY m.client_profile_id ORDER BY m.score DESC NULLS LAST, m.first_queued_at DESC) AS rank
  FROM public.posting_matches m
  JOIN public.client_match_criteria c ON c.client_profile_id = m.client_profile_id AND c.active
  JOIN public.postings_canonical p ON p.id = m.posting_id
  WHERE cardinality(m.rule_failures) = 0
    AND m.action IS NULL
    AND p.last_seen_at > now() - interval '14 days';
REVOKE ALL ON public.client_match_queue FROM anon, authenticated;
COMMENT ON VIEW public.client_match_queue IS
  'Ranked review queue: unactioned postings that pass the client''s hard rules and were seen in the last 14 days, best score first, unjudged last. is_new = first queued after the client''s last review.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- Verify (one row, every column true)
-- ---------------------------------------------------------------------------
-- SELECT
--   to_regclass('public.client_match_criteria') IS NOT NULL AS criteria_table,
--   to_regclass('public.posting_matches') IS NOT NULL AS matches_table,
--   to_regclass('public.match_runs') IS NOT NULL AS runs_table,
--   to_regclass('public.client_match_queue') IS NOT NULL AS queue_view,
--   EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'posting_matches_touch' AND tgrelid = 'public.posting_matches'::regclass) AS first_queued_trigger,
--   (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.posting_matches'::regclass) AS rls_on;
