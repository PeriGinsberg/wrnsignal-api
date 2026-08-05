-- Phase 1 of the tracker/networking merge: one nullable link from an
-- application to a company on the networking board.
--
-- ADDITIVE. No backfill, no default, no existing column altered in type,
-- nullability or default. Every current reader keeps working untouched, and
-- every existing row stays valid with company_id NULL.
--
-- WHY COMPANY LEVEL AND NOT CONTACT LEVEL. A contact reaches an application
-- through their company: network_contacts.company_id already exists, so one
-- link here gives every contact at that company a path to every application
-- there. A contact-to-application link would be a second edge expressing the
-- same fact, and the two would drift.
--
-- Probed on dev before writing, rather than read off the migration files:
--   network_companies EXISTS, id is uuid, live columns are
--     client_profile_id, created_at, domain, id, name, notes, status, tier,
--     updated_at
--   (note: 20260723_network_tracker.sql still says `priority`; the v3
--    reconcile renamed it to `tier` and that older file is stale. Not load
--    bearing here, but it is why the probe happened.)
--   signal_applications.company_id does NOT exist, so this is real work and
--     not a no-op.
--   234 applications, 14 companies, 67 contacts on dev.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL, matching network_contacts.company_id. Removing a company
-- from the networking board must unlink the application, never delete it: the
-- application is tracker data and the board has no business destroying it.
ALTER TABLE public.signal_applications
  ADD COLUMN IF NOT EXISTS company_id uuid
    REFERENCES public.network_companies(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.signal_applications.company_id IS
  'Optional link to a networking board company. NULL means not linked, which is every row before this migration and every row the user declines to link. Never set automatically from a name match; the user confirms every link.';

-- ---------------------------------------------------------------------------
-- 2. The index
-- ---------------------------------------------------------------------------
-- The three new surfaces all ask the same question, "which applications belong
-- to this company", so this is the access path for all of them. Partial: NULL
-- is the overwhelming majority today (234 of 234 rows on dev, 993 of 993 on
-- prod) and nothing ever searches for the unlinked ones by this column.
CREATE INDEX IF NOT EXISTS idx_signal_applications_company
  ON public.signal_applications (company_id)
  WHERE company_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. The boundary this FK CANNOT enforce
-- ---------------------------------------------------------------------------
-- signal_applications is owned by profile_id and network_companies by
-- client_profile_id, both pointing at client_profiles. A foreign key can only
-- prove the company row EXISTS. It cannot prove it belongs to the same person
-- as the application, so a crafted request could link one user's application to
-- another user's company and the database would accept it.
--
-- A CHECK constraint cannot close this either: it may not reference another
-- table. The candidates are a trigger or app-layer enforcement, and this takes
-- app-layer, consistent with every other network table, where the RLS comment
-- already says "belt-and-suspenders; API is the real guard".
--
-- That decision is only safe if the guard is PROVEN rather than remembered.
-- The API test attempts exactly this cross-profile link and asserts rejection.
-- Same class of hole as the is_coach denylist gap: a boundary that holds only
-- because a route remembers to check needs a test that fails when it forgets.
--
-- Deliberately NOT adding RLS here: signal_applications has none today, the
-- routes use service-role and filter explicitly, and adding a policy to one
-- column of one table would imply a protection the rest of the table does not
-- have.

NOTIFY pgrst, 'reload schema';
