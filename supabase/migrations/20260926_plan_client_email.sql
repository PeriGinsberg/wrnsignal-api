-- ═══════════════════════════════════════════════════
-- Networking plan: the client email moves to Postmark — 2026-09-26
-- ═══════════════════════════════════════════════════
--
-- IN PLAIN ENGLISH
--
-- Until now, telling a client their plan was ready meant putting the tag
-- `networking-plan-shared` on their GoHighLevel contact, which fired a GHL
-- workflow that sent the email. SIGNAL never sent it and could not see whether
-- it arrived; all it could record was that the tag went on.
--
-- SIGNAL now sends that email itself, through Postmark, using the template
-- `networking-plan-ready`. The tag is no longer written.
--
-- So the job row needs somewhere to record a send it actually performed. The
-- three ghl_* columns stay exactly as they are: they are the history of what
-- happened before this change, and rewriting history to look like it was always
-- Postmark would make the old rows lie.
--
-- Reversibility:
--   ALTER TABLE networking_plan_jobs
--     DROP COLUMN client_email_sent_at,
--     DROP COLUMN client_email_sent_count,
--     DROP COLUMN client_email_to,
--     DROP COLUMN client_email_error;

ALTER TABLE public.networking_plan_jobs
  -- When the most recent client email went out. NULL means never.
  ADD COLUMN IF NOT EXISTS client_email_sent_at TIMESTAMPTZ,

  -- How many have gone out in total: one on share, plus one per "Re-send
  -- email". Counted rather than inferred so "how many times has this client
  -- been emailed about this plan" has a direct answer.
  ADD COLUMN IF NOT EXISTS client_email_sent_count INTEGER NOT NULL DEFAULT 0,

  -- The address it was actually delivered to. Worth storing because outside
  -- production that is deliberately NOT the client: it is the internal
  -- redirect address, and a row showing a real client address on a preview
  -- deployment would be a bug worth catching.
  ADD COLUMN IF NOT EXISTS client_email_to TEXT,

  -- Last failure, cleared on a success. Separate from ghl_error so a Postmark
  -- problem is never mistaken for a GoHighLevel one.
  ADD COLUMN IF NOT EXISTS client_email_error TEXT;

COMMENT ON COLUMN public.networking_plan_jobs.client_email_sent_at IS
  'When SIGNAL last sent the client the "your plan is ready" email via Postmark. The ghl_tagged_at column is the pre-2026-09-26 equivalent and is no longer written.';

NOTIFY pgrst, 'reload schema';
