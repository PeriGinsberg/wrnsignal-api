-- 20260902_network_messages.sql
-- Messages as first-class rows, by EXTENDING network_actions rather than adding
-- a sibling table.
--
-- WHY EXTENSION, and what it costs. A contact's timeline is the product: what
-- you did and what you wrote are one sequence, and two tables would mean every
-- reader unions them and every reader can get that union wrong. The table
-- already carries contact_id, action_date, author_role and author_id, which is
-- most of a message. It has ZERO production rows, so the reshape is free today
-- and stops being free the moment this ships.
--
-- The distortion, stated rather than discovered: the table was an append-only
-- log of things that HAPPENED, and a draft has not happened. That is real, and
-- it is why status exists and why computeNextDue now excludes drafts. It is
-- paid for in one place (the engine) rather than at every call site.
--
-- A MESSAGE IS EXACTLY A ROW WITH A BODY. That is the discriminator, enforced
-- below: no extra "kind" column, and no way to have half a message.
--
-- contact_id is ALREADY NOT NULL, so "there is no contact-less message" needs
-- no new constraint. Stated because it was a requirement and it is already met.
--
-- SAFE OVER EXISTING ROWS: every new column is nullable with no default, so
-- dev's 78 logged actions and prod's 0 all satisfy the "not a message" branch
-- of the shape check without a backfill.

ALTER TABLE public.network_actions
  ADD COLUMN IF NOT EXISTS body    text,
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS status  text,
  -- The application this message is about, when the user says so. ON DELETE SET
  -- NULL, matching network_contacts.company_id and signal_applications.
  -- company_id: deleting an application must not delete what you wrote.
  ADD COLUMN IF NOT EXISTS application_id uuid
    REFERENCES public.signal_applications(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.network_actions.body IS
  'The message text. NULL on a plain logged action; NOT NULL is what makes a row a message. Distinct from `note`, which is annotation ABOUT an entry.';
COMMENT ON COLUMN public.network_actions.status IS
  'draft | sent, on message rows only. NULL on logged actions, which have always simply happened. ONE ROW flips draft -> sent; editing a draft overwrites it and there is no revision history.';
COMMENT ON COLUMN public.network_actions.application_id IS
  'Optional. Offered only from applications already linked to the contact''s company. NEVER matched by company name; see 20260805_application_company_link.sql.';

ALTER TABLE public.network_actions
  DROP CONSTRAINT IF EXISTS network_actions_channel_check;
ALTER TABLE public.network_actions
  ADD CONSTRAINT network_actions_channel_check
    CHECK (channel IS NULL OR channel IN ('email','linkedin'));

ALTER TABLE public.network_actions
  DROP CONSTRAINT IF EXISTS network_actions_status_check;
ALTER TABLE public.network_actions
  ADD CONSTRAINT network_actions_status_check
    CHECK (status IS NULL OR status IN ('draft','sent'));

-- The shape rule. A row is either a logged action (no message fields at all) or
-- a message (body, channel and status all present). Half a message -- a body
-- with no status, a status with no body -- is not a state this product has, and
-- letting one exist would put the branch in every reader instead of here.
--
-- `subject` is deliberately outside the requirement: it is optional even on a
-- message, and meaningless on a linkedin one.
ALTER TABLE public.network_actions
  DROP CONSTRAINT IF EXISTS network_actions_message_shape;
ALTER TABLE public.network_actions
  ADD CONSTRAINT network_actions_message_shape
    CHECK (
      (body IS NULL AND channel IS NULL AND status IS NULL AND subject IS NULL)
      OR
      (body IS NOT NULL AND channel IS NOT NULL AND status IS NOT NULL)
    );

-- The composer asks one question on load: has this contact got a draft? Partial,
-- because drafts are the rare row and nothing ever scans for the sent ones by
-- status alone.
CREATE INDEX IF NOT EXISTS idx_network_actions_drafts
  ON public.network_actions (contact_id) WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS idx_network_actions_application
  ON public.network_actions (application_id) WHERE application_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
