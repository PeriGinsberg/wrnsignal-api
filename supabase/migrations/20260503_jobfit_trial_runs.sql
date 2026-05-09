-- Free-trial JobFit run cache.
--
-- The redesigned free trial runs a real runJobFit() against a one-shot
-- (resume + JD) submission and gates the second attempt on the same JD
-- by returning the cached result with the locked-surface metadata. This
-- table holds those cached results — keyed on (email, jd_hash) so that
-- a returning user submitting the same job sees the original analysis,
-- not a fresh run.
--
-- TTL: indefinite. The trial flow is one-and-done per email; if the
-- user wants to re-analyze they must upgrade. We don't expire results.

CREATE TABLE IF NOT EXISTS public.jobfit_trial_runs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL,
  jd_hash     text        NOT NULL,
  result_json jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT jobfit_trial_runs_email_jd_hash_unique UNIQUE (email, jd_hash)
);

CREATE INDEX IF NOT EXISTS jobfit_trial_runs_email_idx
  ON public.jobfit_trial_runs(email);
