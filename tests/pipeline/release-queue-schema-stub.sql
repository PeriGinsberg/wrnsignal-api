-- Just enough of the SIGNAL schema for the Job Queue migrations to apply to a
-- blank Postgres (tests/pipeline/release-queue-pg.sh). Columns only; no data.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;

CREATE TABLE public.postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text, title text, cleaned_title text, company text, location text, apply_url text,
  years_min int, years_max int, years_basis text, salary_low numeric, salary_high numeric, salary_period text,
  application_deadline date, requirements_summary text, required_majors text[], majors_basis text,
  posted_at timestamptz, first_seen_at timestamptz DEFAULT now(), last_seen_at timestamptz DEFAULT now(),
  link_checked_at timestamptz, link_check_status text, start_type text, start_date date, start_season text,
  start_year int, start_text text, employment_types text[], campus_signal boolean DEFAULT false,
  apply_link_kind text, closed_at timestamptz
);
CREATE TABLE public.posting_links (secondary_id uuid);
CREATE VIEW public.postings_canonical AS
  SELECT p.* FROM public.postings p WHERE NOT EXISTS (SELECT 1 FROM public.posting_links l WHERE l.secondary_id = p.id);

CREATE TABLE public.client_match_criteria (
  client_profile_id uuid PRIMARY KEY, active boolean DEFAULT true, last_reviewed_at timestamptz, available_from date
);
CREATE TABLE public.coach_clients (coach_profile_id uuid, client_profile_id uuid, status text);
CREATE TABLE public.coach_delegates (delegate_coach_profile_id uuid, principal_coach_profile_id uuid, status text);
CREATE TABLE public.posting_coach_flags (posting_id uuid, practice_coach_id uuid, flag text, apply_url text, url_saved_at timestamptz);

CREATE TABLE public.posting_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL, posting_id uuid NOT NULL REFERENCES public.postings(id),
  score int, judge_reason text, judge_evidence jsonb, first_queued_at timestamptz,
  apply_url text, apply_link_kind text, preferred_market boolean DEFAULT false,
  action text, rule_failures text[] NOT NULL DEFAULT '{}', dismiss_reason text, note text, actioned_at timestamptz,
  jobfit_score int, jobfit_decision text, already_added boolean,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), night date, step text, status text DEFAULT 'running',
  started_at timestamptz DEFAULT now(),
  CONSTRAINT pipeline_runs_step_valid CHECK (step IN ('google_jobs', 'enrich', 'match', 'link_check'))
);
