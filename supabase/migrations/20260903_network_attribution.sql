-- 20260903_network_attribution.sql
-- Who created a networking row, and who last edited it.
--
-- network_actions has carried author_role/author_id since v1, so messages and
-- logged actions are already attributed. Contacts and companies had nothing,
-- which was fine while only the owner could write them and stops being fine the
-- moment a coach can.
--
-- CREATED AND EDITED ARE SEPARATE PAIRS, deliberately. A contact the client
-- created and a coach edited is the CLIENT'S contact with a coach edit on it,
-- not the coach's contact. One overwritten author column cannot say that, and
-- the difference is the whole point of showing attribution to a client at all.
--
-- created_by_role IS NOT NULL DEFAULT 'client', AND THAT NEEDS NO BACKFILL
-- SCRIPT, because it states a fact rather than a guess: no coach route has ever
-- touched network_contacts or network_companies, so every existing row is
-- client-created by construction. The default is correct for all of them.
--
-- created_by_id IS NULLABLE on purpose. Rows written before attribution existed
-- have no recorded actor, and NULL says that honestly. Filling it with
-- client_profile_id would manufacture a record of something nobody observed.
--
-- edited_* stay NULL until someone edits, so "never edited" and "edited by the
-- owner" remain distinguishable. A UI that cannot tell those apart ends up
-- captioning every untouched row.
--
-- NOTHING HERE IS REVOKED WHEN A RELATIONSHIP ENDS. These are plain columns:
-- coach-authored rows persist unchanged, which is the decided behaviour.

ALTER TABLE public.network_contacts
  ADD COLUMN IF NOT EXISTS created_by_role text NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS created_by_id   uuid,
  ADD COLUMN IF NOT EXISTS edited_by_role  text,
  ADD COLUMN IF NOT EXISTS edited_by_id    uuid,
  ADD COLUMN IF NOT EXISTS edited_at       timestamptz;

ALTER TABLE public.network_companies
  ADD COLUMN IF NOT EXISTS created_by_role text NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS created_by_id   uuid,
  ADD COLUMN IF NOT EXISTS edited_by_role  text,
  ADD COLUMN IF NOT EXISTS edited_by_id    uuid,
  ADD COLUMN IF NOT EXISTS edited_at       timestamptz;

-- 'system' is deliberately absent, unlike network_actions.author_role. Nothing
-- creates a contact or a company on its own; the import is a client acting.
ALTER TABLE public.network_contacts DROP CONSTRAINT IF EXISTS network_contacts_created_by_role_check;
ALTER TABLE public.network_contacts ADD CONSTRAINT network_contacts_created_by_role_check
  CHECK (created_by_role IN ('client','coach'));
ALTER TABLE public.network_contacts DROP CONSTRAINT IF EXISTS network_contacts_edited_by_role_check;
ALTER TABLE public.network_contacts ADD CONSTRAINT network_contacts_edited_by_role_check
  CHECK (edited_by_role IS NULL OR edited_by_role IN ('client','coach'));

ALTER TABLE public.network_companies DROP CONSTRAINT IF EXISTS network_companies_created_by_role_check;
ALTER TABLE public.network_companies ADD CONSTRAINT network_companies_created_by_role_check
  CHECK (created_by_role IN ('client','coach'));
ALTER TABLE public.network_companies DROP CONSTRAINT IF EXISTS network_companies_edited_by_role_check;
ALTER TABLE public.network_companies ADD CONSTRAINT network_companies_edited_by_role_check
  CHECK (edited_by_role IS NULL OR edited_by_role IN ('client','coach'));

COMMENT ON COLUMN public.network_contacts.created_by_role IS
  'client | coach. Never changes. A coach editing a client''s contact does not make it the coach''s.';
COMMENT ON COLUMN public.network_contacts.edited_by_role IS
  'client | coach, or NULL for never edited since attribution existed.';

NOTIFY pgrst, 'reload schema';
