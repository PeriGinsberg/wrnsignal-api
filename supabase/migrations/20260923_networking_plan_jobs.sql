-- 20260923_networking_plan_jobs.sql
-- FRD: docs/Features/networking-plan-delivery-frd.md
--
-- One row per Networking Plan delivery: generate the PDF, upload it to the
-- client's Shared Drive folder, file it in the client's library hidden, and
-- later share it.
--
-- WHY A TABLE AND NOT JUST DOING THE WORK. The job spans two external systems
-- and two databases with no transaction across them, so partial failure is
-- normal rather than exceptional. This row is what makes a half-finished run
-- recoverable: it remembers the Drive file that already exists, so a retry
-- updates that file instead of uploading a second copy, and it remembers the
-- library row, so a retry cannot file the same plan twice.

CREATE TABLE IF NOT EXISTS public.networking_plan_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who it is for. coach_client_id is the relationship; client_profile_id is
  -- the board. Both denormalized, the way coach_client_documents does it, so a
  -- read never has to join to know whose plan this is.
  coach_client_id   uuid NOT NULL REFERENCES public.coach_clients(id) ON DELETE CASCADE,
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id),
  created_by_id     uuid NOT NULL,          -- the coach's client_profiles.id

  -- IDEMPOTENCY. sha256 of the parsed Outreach Messages rows: the same workbook
  -- for the same client is the same job. A double-clicked button finds this row
  -- instead of starting a second run, and a genuinely new workbook is genuinely
  -- a new job.
  source_hash       text NOT NULL,

  status            text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','complete','failed')),

  -- What has SUCCEEDED, not what is next: a crash between two steps then reads
  -- as the earlier value, which is the safe direction to be wrong in.
  step              text NOT NULL DEFAULT 'none'
    CHECK (step IN ('none','generated','uploaded','filed')),

  -- Set once, on the first successful upload, and reused by every retry. This
  -- single column is why a retry produces a new REVISION rather than a second
  -- file, and why the library link never changes.
  drive_file_id     text,
  drive_file_url    text,

  document_id       uuid REFERENCES public.coach_client_documents(id) ON DELETE SET NULL,

  -- Sharing. Access rides on the link rather than on an identity, so revoking
  -- means deleting this exact permission. Ending a coaching relationship hides
  -- the library row but deliberately does NOT unshare the Drive file; this id
  -- is what makes a manual unshare precise later.
  shared_at           timestamptz,
  drive_permission_id text,

  error             text,                   -- last failure, operator-readable
  attempts          integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- The idempotency guarantee, enforced rather than hoped for.
CREATE UNIQUE INDEX IF NOT EXISTS uq_networking_plan_jobs_source
  ON public.networking_plan_jobs (coach_client_id, source_hash);

-- "Show me this client's plans, newest first" is the only listing query.
CREATE INDEX IF NOT EXISTS idx_networking_plan_jobs_client
  ON public.networking_plan_jobs (client_profile_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_networking_plan_jobs_set_updated_at ON public.networking_plan_jobs;
CREATE TRIGGER trg_networking_plan_jobs_set_updated_at
  BEFORE UPDATE ON public.networking_plan_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: belt and suspenders. Every route reaches this table with the service
-- role, so the route's own coach_clients check is the real guard, exactly as it
-- is for coach_client_documents. No policy is created, so a direct REST call
-- with an anon or authenticated JWT reads nothing.
ALTER TABLE public.networking_plan_jobs ENABLE ROW LEVEL SECURITY;

-- Rollback:
--   DROP TABLE IF EXISTS public.networking_plan_jobs;
