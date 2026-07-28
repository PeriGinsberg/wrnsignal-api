-- 20260728_network_client_profile_seed_tracking.sql
-- ADDITIVE: seed bookkeeping for network_client_profile (Phase 7b).
--
-- The profile is ONE-TIME SEEDED from client_profiles, never live-mirrored. Two
-- of the seeded fields make mirroring actively wrong:
--   • key_strength comes from coach_notes_strengths — a COACH's private note. A
--     mirror would let a coach editing their notes silently rewrite the client's
--     outreach copy.
--   • a networking pitch is worded differently from a formal profile, so any
--     mirror would overwrite the client's tuning on every profile edit.
--
-- touched_fields records which fields the USER has written, so "refresh from
-- profile" can re-offer itself for untouched fields only.
--
-- WHY AN ARRAY RATHER THAN "IS THE FIELD EMPTY"
-- Emptiness cannot tell never-seeded from deliberately-cleared. A client who
-- deletes the coach's strengths note because it does not fit has TOUCHED that
-- field, and a refresh must not put it back. Only an explicit record of user
-- writes gets that right.

-- AUTO-FILL, NOT AUTO-REWRITE
-- A client's source data fills in over time (intake, résumé upload, coach notes),
-- usually AFTER they first open the networking profile — so a one-shot seed
-- catches an empty source and the profile stays blank until someone thinks to
-- press Refresh, which nobody does. Every GET therefore fills fields that are
-- EMPTY *and* untouched *and* whose source now has a value.
--
-- Restricted to EMPTY on purpose. touched_fields cannot tell "never seen it"
-- from "read it and was happy with it", so re-seeding every untouched field
-- would silently rewrite copy the client had already accepted — with
-- key_strength that means a coach editing a private note changes client-facing
-- outreach text. Filling a blank is help; changing something they have seen
-- needs their intent, which is what the Refresh button is for.

ALTER TABLE public.network_client_profile
  ADD COLUMN IF NOT EXISTS touched_fields text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS seeded_at timestamptz,
  -- Stamped when the résumé extraction RUNS, whatever it yields. Without it, a
  -- résumé that parses to no usable role leaves both fields empty, so the next
  -- page open recomputes "pending" as true and fires another live LLM call —
  -- on every open, forever. Attempted-once is the gate; the Refresh button is
  -- the deliberate way to try again after a new résumé is uploaded.
  ADD COLUMN IF NOT EXISTS resume_seed_attempted_at timestamptz;

-- PostgREST caches the schema; without this the new columns are invisible to
-- the API even though the table has them.
NOTIFY pgrst, 'reload schema';
