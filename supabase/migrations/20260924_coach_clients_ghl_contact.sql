-- 20260924_coach_clients_ghl_contact.sql
-- The GHL contact a coached client corresponds to, resolved once and stored.
--
-- WHY STORED RATHER THAN RESOLVED PER CALL. Matching is the weakest link in the
-- Networking Plan sync: get it wrong and the plan link is emailed to the wrong
-- person. Resolving lazily inside the Share click means the first time anyone
-- notices a bad match is after the email has gone. Resolving once, at folder
-- setup, lets the coach SEE the matched contact name and correct it before
-- anything is sent.
--
-- WHY NOT signal_seats. That table already carries ghl_contact_id and is
-- populated on all 24 of its rows, which makes it look like the answer. It is
-- not: it covers seat purchasers, a different and much smaller cohort than the
-- 74 coach_clients, and only 9 of its 24 seat emails resolve to a
-- client_profiles row at all. Using it as the lookup would silently fail for
-- most coached clients.
--
-- RESOLUTION NEVER CREATES A CONTACT. GET /contacts/search/duplicate is
-- read-only. When it finds nothing the coach pastes the GHL contact link, which
-- is a human confirming identity rather than software inventing a record.

ALTER TABLE public.coach_clients
  -- The GHL contact id. NULL means unresolved: no plan can be shared yet.
  ADD COLUMN IF NOT EXISTS ghl_contact_id text,

  -- What the contact was called when we matched it, so a coach reviewing the
  -- setting later sees a name rather than an opaque id, and so a silent
  -- re-point to a different contact is visible in the diff.
  ADD COLUMN IF NOT EXISTS ghl_contact_name text,

  -- How the id got here. 'search' = matched by email; 'pasted' = the coach
  -- supplied the link. Kept because the two carry different confidence and a
  -- pasted id should not be quietly overwritten by a later search.
  ADD COLUMN IF NOT EXISTS ghl_contact_source text,

  ADD COLUMN IF NOT EXISTS ghl_contact_resolved_at timestamptz;

ALTER TABLE public.coach_clients
  ADD CONSTRAINT coach_clients_ghl_contact_source_known CHECK (
    ghl_contact_source IS NULL OR ghl_contact_source IN ('search', 'pasted')
  ),
  -- An id with no provenance and no timestamp is an id nobody can audit.
  ADD CONSTRAINT coach_clients_ghl_contact_complete CHECK (
    ghl_contact_id IS NULL
    OR (ghl_contact_source IS NOT NULL AND ghl_contact_resolved_at IS NOT NULL)
  );

-- Two coached clients pointing at ONE GHL contact means one of them gets the
-- other's plan link emailed to them. Partial so the 74 existing unresolved rows
-- are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS coach_clients_ghl_contact_unique
  ON public.coach_clients (ghl_contact_id)
  WHERE ghl_contact_id IS NOT NULL;

COMMENT ON COLUMN public.coach_clients.ghl_contact_id IS
  'GoHighLevel contact id for this client, resolved once at folder setup. NULL means unresolved and blocks Networking Plan sharing. Never populated by an upsert; either matched read-only by email or pasted by the coach.';

NOTIFY pgrst, 'reload schema';
