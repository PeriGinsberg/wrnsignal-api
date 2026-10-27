-- 20261116_suggestion_job_description.sql
-- The posting's text on a supporter's suggestion, optional.
--
-- JobFit cannot score without the job description, and the link alone often
-- cannot supply it: LinkedIn and Indeed block the fetch, and postings come
-- down. The supporter is usually looking at the text when they suggest the
-- job, so they can paste it. "Score this job now" on the accepted tracker row
-- then fills it into JobFit (GET /api/applications/[id]/score-prefill).
--
-- Requires 20261115_client_supporters.sql. Additive; safe to run twice.

ALTER TABLE public.supporter_job_suggestions
  ADD COLUMN IF NOT EXISTS job_description text NOT NULL DEFAULT '';

ALTER TABLE public.supporter_job_suggestions
  DROP CONSTRAINT IF EXISTS supporter_job_suggestions_job_description_len;
ALTER TABLE public.supporter_job_suggestions
  ADD CONSTRAINT supporter_job_suggestions_job_description_len
  CHECK (length(job_description) <= 50000);

-- Verify:
-- SELECT column_name, data_type, column_default FROM information_schema.columns
--  WHERE table_name = 'supporter_job_suggestions' AND column_name = 'job_description';  -- text | ''::text
