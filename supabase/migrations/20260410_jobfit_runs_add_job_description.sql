-- Add job_description column to jobfit_runs so the raw JD text can be
-- restored on deep link return without re-fetching from an external source.
ALTER TABLE public.jobfit_runs
ADD COLUMN job_description text NULL;
