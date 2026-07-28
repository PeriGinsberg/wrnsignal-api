-- 20260724_network_additional_info.sql
-- Migration 4 — add additional_info to network_contacts: per-contact context
-- (hand-written opening lines, "why this person" notes) — the strongest column
-- in real client lists. Feeds Phase 8 templates as the [ADDITIONAL_INFO] merge
-- variable. (IMPORT.md §8 proposed this under the name 'personalization'; the
-- agreed name is additional_info.)
--
-- ADDITIVE ALTER — NOT a re-drop. Independent of and order-agnostic with
-- 20260724_network_first_milestones.sql. Re-runnable via ADD COLUMN IF NOT EXISTS.
--
-- Detail-page only: values are full sentences and never appear as a spreadsheet
-- column. Client-editable on the contact record; importable in Phase 6.
--
-- DEV first via the Supabase SQL Editor; prod promotion is a separate step.

ALTER TABLE public.network_contacts
  ADD COLUMN IF NOT EXISTS additional_info text;
