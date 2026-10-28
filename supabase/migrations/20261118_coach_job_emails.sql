-- 20261118_coach_job_emails.sql
-- The queue behind "your coach added a job" emails.
--
-- POST /api/coach/recommend-job adds one row per job it puts on a client's
-- tracker. A cron (/api/internal/coach-jobs/send-emails, every 5 minutes)
-- sends ONE email per coach and client once the oldest unsent job for that
-- pair is 10 minutes old, naming every job queued for them by then. So a coach
-- who adds three jobs in a sitting sends one email, not three.
--
-- A job deleted before the email goes takes its row with it (ON DELETE
-- CASCADE), so the email never names a job the client cannot find.
--
-- claimed_at is the send lock: the cron claims rows with a conditional update
-- before sending, so two overlapping runs cannot both email the same jobs.
-- A claimed row is never retried; outcome says what happened to it.
--
-- Additive; safe to run twice.

CREATE TABLE IF NOT EXISTS public.coach_job_emails (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    uuid NOT NULL UNIQUE REFERENCES public.signal_applications(id) ON DELETE CASCADE,
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  -- The coach who clicked (a delegate, not the principal they act for): the
  -- email names them, and jobs are grouped per coach.
  coach_profile_id  uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  coach_client_id   uuid REFERENCES public.coach_clients(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  claimed_at        timestamptz,
  sent_at           timestamptz,
  outcome           text CHECK (outcome IN ('sent', 'failed', 'skipped')),
  detail            text
);

CREATE INDEX IF NOT EXISTS coach_job_emails_unclaimed
  ON public.coach_job_emails (created_at) WHERE claimed_at IS NULL;

-- Server only: RLS on, no policies, so only the service role reads or writes it.
ALTER TABLE public.coach_job_emails ENABLE ROW LEVEL SECURITY;

-- Verify:
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'coach_job_emails';  -- true
-- SELECT count(*) FROM public.coach_job_emails;                            -- 0
