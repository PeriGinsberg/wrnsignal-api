-- 20260512_signal_applications_run_fks.sql
--
-- Foundation Stage 1a — add positioning_run_id and coverletter_run_id FK
-- columns to signal_applications. Converts signal_applications into the
-- unifying record for application prep (alongside jobfit_run_id, which
-- already exists).
--
-- FRD: docs/Features/positioning-foundation-frd.md (section 4.3)
-- Runlog: docs/Features/foundation-migration-runlog.md
--
-- Both columns are nullable. No CASCADE on delete (preserves signal_application
-- if a run is deleted; same convention as jobfit_run_id).
--
-- Cover Letter route does NOT populate coverletter_run_id in Foundation —
-- deferred to the Cover Letter Integration FRD (see Foundation FRD section
-- 4.3). The column is added now so the schema is complete; nullability means
-- nothing breaks while the writer is unimplemented.
--
-- DEV ENV ONLY. Apply via Supabase SQL Editor. Document execution in runlog.

ALTER TABLE public.signal_applications
  ADD COLUMN positioning_run_id UUID REFERENCES public.positioning_runs(id),
  ADD COLUMN coverletter_run_id UUID REFERENCES public.coverletter_runs(id);

CREATE INDEX idx_signal_applications_positioning_run
  ON public.signal_applications (positioning_run_id);

CREATE INDEX idx_signal_applications_coverletter_run
  ON public.signal_applications (coverletter_run_id);
