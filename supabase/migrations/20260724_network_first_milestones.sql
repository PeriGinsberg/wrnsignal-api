-- 20260724_network_first_milestones.sql
-- Migration 3 — add three "first reached" milestone timestamps to
-- network_contacts, needed by the dashboard's reply / chat rates
-- (docs/network-tracker/network-tracker-dashboard.md, Part 1 & Part 3).
--
-- ADDITIVE ALTER — NOT a re-drop. Seeded/imported data survives. Re-runnable
-- via ADD COLUMN IF NOT EXISTS.
--
-- Each is stamped ONCE, on the FIRST time the contact reaches that milestone,
-- and NEVER recomputed — so a reply rate does not fall as contacts progress
-- past 'replied'. Stamping lives in the API routes (set-once, only when NULL):
--   first_touch_at   — first outreach: a touch_1 action, or entering sequence_active
--   first_replied_at — first transition into stage 'replied'
--   first_chat_at    — first transition into stage 'chat_scheduled'
--
-- DEV first via the Supabase SQL Editor; prod promotion is a separate step.

ALTER TABLE public.network_contacts
  ADD COLUMN IF NOT EXISTS first_touch_at   timestamptz,
  ADD COLUMN IF NOT EXISTS first_replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_chat_at    timestamptz;
