-- 20260923_network_contact_phone.sql
--
-- A phone number on a networking contact.
--
-- network_contacts has carried email and linkedin_url since v1 but never a
-- phone, so a number could only live in `notes` or `additional_info` as prose,
-- where nothing can dial it and nothing can tell it apart from the rest of the
-- text. The import has been quietly hitting this for months: a spreadsheet's
-- Email cell holding a phone number is diverted into a note_logged action
-- ("Imported contact method: 312-555-0148") precisely because there was no
-- column to put it in.
--
-- TEXT, not a validated format. Numbers arrive as "+1 (312) 555-0148",
-- "312.555.0148 x22", or a WhatsApp handle, and a CHECK constraint that
-- rejected any of those would lose data the user typed on purpose. The column
-- stores what the person entered; presentation is the UI's problem.
--
-- Nullable with no default: most contacts will never have one, and NULL says
-- "not known" where '' would say "known to be empty".
--
-- coach_clients.phone (20260525_prospect_phone.sql) is a different column on a
-- different table: that one is the coach's PROSPECT capture, this one is a
-- person on a client's networking board.

ALTER TABLE public.network_contacts
  ADD COLUMN IF NOT EXISTS phone text;

-- Rollback:
--   ALTER TABLE public.network_contacts DROP COLUMN IF EXISTS phone;
