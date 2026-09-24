-- 20260924_networking_plan_jobs_ghl.sql
-- What the GHL half of a share did, recorded per job.
--
-- Separate timestamps rather than one ghl_synced boolean, because the two calls
-- fail independently and mean different things:
--
--   ghl_note_added_at  an audit line on the contact. Cosmetic.
--   ghl_tagged_at      THE CLIENT HAS BEEN EMAILED. Irreversible.
--
-- Collapsing them would make "shared but never told" unqueryable, and that is
-- the exact state a retry needs to find:
--
--   SELECT * FROM networking_plan_jobs
--   WHERE shared_at IS NOT NULL AND ghl_tagged_at IS NULL;
--
-- ghl_email_sent_count exists because re-sending is a deliberate, rare act. If
-- it ever climbs past 1 or 2 on a single job, somebody is clicking a button
-- that is emailing a real person repeatedly, and that should be visible.

ALTER TABLE public.networking_plan_jobs
  ADD COLUMN IF NOT EXISTS ghl_contact_id       text,
  ADD COLUMN IF NOT EXISTS ghl_note_added_at    timestamptz,
  ADD COLUMN IF NOT EXISTS ghl_tagged_at        timestamptz,
  ADD COLUMN IF NOT EXISTS ghl_email_sent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ghl_error            text;

ALTER TABLE public.networking_plan_jobs
  ADD CONSTRAINT networking_plan_jobs_ghl_count_sane CHECK (ghl_email_sent_count >= 0),
  -- A tag time with no contact id is a record nobody can act on or verify.
  ADD CONSTRAINT networking_plan_jobs_ghl_tag_has_contact CHECK (
    ghl_tagged_at IS NULL OR ghl_contact_id IS NOT NULL
  );

COMMENT ON COLUMN public.networking_plan_jobs.ghl_tagged_at IS
  'When networking-plan-shared was added in GHL, which is when the client was emailed. NULL after a successful share means the plan is visible to the client but nobody has told them.';

NOTIFY pgrst, 'reload schema';
