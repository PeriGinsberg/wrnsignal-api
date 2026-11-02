-- 20261120_job_queue_matches.sql
-- Job Queue (1 of 4): the coach's decision on a match, and what came of it.
--
-- posting_matches already has action / dismiss_reason / note / actioned_at /
-- actioned_by, unused until now. The Job Queue writes them:
--   action 'evaluating'  the coach opened Add Job for this client (NEW value)
--   action 'push'        Fit: added to the client's tracker through Source a Job
--   action 'dismiss'     Not a fit, with a reason
-- A decision is written to every copy of the same job (app/api/coach/job-queue).
--
-- NEW COLUMNS
--   jobfit_score, jobfit_decision, jobfit_run_id   the JobFit run Add Job made
--   signal_application_id                          the tracker row it created
--   score_at_action, rank_at_action,               the judge's score and the
--   queue_size_at_action                           client's queue rank and size
--                                                  when the coach decided: what
--                                                  the weekly measure reads
-- NEW DISMISS REASONS: pay_too_low, wrong_timing, wrong_major. 'other' now
-- needs a note. The older lane reasons stay valid.
--
-- The matcher never re-judges a row with an action (lib/match/runMatching.ts),
-- so an 'evaluating' row keeps its score. client_match_queue shows it until it
-- is decided (20261120_posting_coach_flags.sql).
--
-- Requires 20261101_matching.sql. Same file for dev and prod. Additive; safe
-- to run twice. One transaction.

BEGIN;

ALTER TABLE public.posting_matches
  ADD COLUMN IF NOT EXISTS jobfit_score smallint,
  ADD COLUMN IF NOT EXISTS jobfit_decision text,
  ADD COLUMN IF NOT EXISTS jobfit_run_id uuid REFERENCES public.jobfit_runs (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signal_application_id uuid REFERENCES public.signal_applications (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS score_at_action smallint,
  ADD COLUMN IF NOT EXISTS rank_at_action integer,
  ADD COLUMN IF NOT EXISTS queue_size_at_action integer;

COMMENT ON COLUMN public.posting_matches.jobfit_score IS 'JobFit score from the Job Queue''s Add Job (coach Source a Job). NULL until run.';
COMMENT ON COLUMN public.posting_matches.jobfit_run_id IS 'jobfit_runs row Add Job created.';
COMMENT ON COLUMN public.posting_matches.signal_application_id IS 'Tracker row Add Job created (action push).';
COMMENT ON COLUMN public.posting_matches.score_at_action IS 'Judge score when the coach decided. Kept so a later re-judge cannot rewrite history.';
COMMENT ON COLUMN public.posting_matches.rank_at_action IS 'client_match_queue rank when the coach decided.';
COMMENT ON COLUMN public.posting_matches.queue_size_at_action IS 'Size of the client''s queue when the coach decided. rank / size = the rank percentile the weekly measure reports.';

ALTER TABLE public.posting_matches DROP CONSTRAINT IF EXISTS posting_matches_action_valid;
ALTER TABLE public.posting_matches ADD CONSTRAINT posting_matches_action_valid
  CHECK (action IS NULL OR action IN ('evaluating', 'push', 'dismiss', 'cleared'));

ALTER TABLE public.posting_matches DROP CONSTRAINT IF EXISTS posting_matches_dismiss_reason;
ALTER TABLE public.posting_matches ADD CONSTRAINT posting_matches_dismiss_reason CHECK (
  -- IS NOT NULL first: "NULL IN (...)" is NULL, and a CHECK passes on NULL.
  (action = 'dismiss' AND dismiss_reason IS NOT NULL AND dismiss_reason IN (
    'too_senior', 'too_junior', 'wrong_function', 'wrong_industry', 'wrong_location',
    'right_employer_wrong_level', 'doesnt_meet_requirements', 'already_applied', 'other',
    'pay_too_low', 'wrong_timing', 'wrong_major'))
  OR ((action IS NULL OR action IN ('evaluating', 'push', 'cleared')) AND dismiss_reason IS NULL)
);

ALTER TABLE public.posting_matches DROP CONSTRAINT IF EXISTS posting_matches_other_needs_note;
ALTER TABLE public.posting_matches ADD CONSTRAINT posting_matches_other_needs_note CHECK (
  dismiss_reason IS DISTINCT FROM 'other' OR length(btrim(coalesce(note, ''))) > 0
);

-- The weekly measure and the judge's examples read decisions by client and time.
CREATE INDEX IF NOT EXISTS posting_matches_actioned_idx
  ON public.posting_matches (client_profile_id, actioned_at DESC)
  WHERE action IN ('push', 'dismiss');

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify (every row true):
-- SELECT 'columns' AS check, (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posting_matches'
--          AND column_name IN ('jobfit_score','jobfit_decision','jobfit_run_id','signal_application_id','score_at_action','rank_at_action','queue_size_at_action')) = 7 AS ok
-- UNION ALL SELECT 'evaluating allowed', pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'posting_matches_action_valid')) LIKE '%evaluating%'
-- UNION ALL SELECT 'new reasons', pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'posting_matches_dismiss_reason')) LIKE '%wrong_major%'
-- UNION ALL SELECT 'other needs note', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posting_matches_other_needs_note')
-- UNION ALL SELECT 'index', to_regclass('public.posting_matches_actioned_idx') IS NOT NULL;
