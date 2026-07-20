-- 20260720_positioning_runs_jobfit_link.sql
--
-- Positioning Half B (positioning slice). Add a direct jobfit_run_id link to
-- v1 positioning_runs so the "View in SIGNAL" bundle (GET /api/runs/[id]) can
-- resolve this-job positioning by the deep-link jobfit run id, replacing the
-- dead cross-function fingerprint join.
--
-- Nullable, no default: standalone positioning runs (no upstream jobfit_result)
-- stamp NULL and stay invisible in the bundle (never worse than today's
-- always-null). Existing rows are NULL until backfilled — new runs light up
-- going forward.
--
-- Index supports the reader's equality lookup (WHERE jobfit_run_id = <id>).
--
-- DEV ENV ONLY first. Apply via Supabase SQL Editor. Prod promotion is a
-- separate explicit step. MUST be applied before the stamping code runs
-- against a given DB, else the positioning_runs INSERT fails on the missing
-- column.

ALTER TABLE public.positioning_runs
  ADD COLUMN jobfit_run_id UUID REFERENCES public.jobfit_runs(id);

CREATE INDEX IF NOT EXISTS idx_positioning_runs_jobfit_run_id
  ON public.positioning_runs (jobfit_run_id);
