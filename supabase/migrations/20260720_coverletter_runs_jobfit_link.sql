-- 20260720_coverletter_runs_jobfit_link.sql
--
-- Cover letter slice (Half B). Same jobfit_run_id link strategy as positioning
-- (20260720_positioning_runs_jobfit_link): add a direct jobfit_run_id link to
-- coverletter_runs so the "View in SIGNAL" bundle (GET /api/runs/[id]) can
-- resolve this-job cover letter by the deep-link jobfit run id, replacing the
-- dead cross-function fingerprint join.
--
-- Nullable, no default: standalone cover letters (no upstream jobfit_result)
-- stamp NULL and stay invisible in the bundle. Existing rows are NULL until
-- backfilled — new runs light up going forward.
--
-- DEV ENV ONLY first. Apply via Supabase SQL Editor. Prod promotion is a
-- separate explicit step. MUST be applied before the stamping code runs
-- against a given DB, else the coverletter_runs upsert fails on the missing
-- column.

ALTER TABLE public.coverletter_runs
  ADD COLUMN jobfit_run_id UUID REFERENCES public.jobfit_runs(id);

CREATE INDEX IF NOT EXISTS idx_coverletter_runs_jobfit_run_id
  ON public.coverletter_runs (jobfit_run_id);
