-- 20260722_coaching_notes_client_read_policy.sql
--
-- Client-side notes, step 1: the deferred client SELECT policy on coaching_notes
-- (foreshadowed in 20260722_coaching_notes.sql). Phase 2 of the notes feature.
--
-- Grants a CLIENT read access to a coaching_notes row ONLY when BOTH hold:
--   (a) the note is ABOUT them  — client_profile_id = the caller's own profile
--   (b) the note is SHARED       — visibility = 'shared'
-- A client can never see a 'private' note (any author), and can never see a note
-- about a different client. See the confirmation notes below.
--
-- Belt-and-suspenders, like the coach-owner policy: the eventual client-read API
-- uses service-role (which bypasses RLS) + an explicit
-- (client_profile_id = me AND visibility = 'shared') filter, so this policy is
-- defense-in-depth for any direct/token DB access, not the sole guard.
--
-- Additive only: adds ONE new SELECT policy to the existing coaching_notes
-- table. It does not alter the table's columns/data, and leaves the existing
-- coach-owner policy (coaching_notes_coach_owner_access) untouched. RLS is
-- already enabled by the table migration.
--
-- Reversibility:
--   DROP POLICY "coaching_notes_client_read_shared" ON public.coaching_notes;
--
-- DEV ENV ONLY first. Apply via Supabase SQL Editor; prod promotion is a
-- separate explicit step. Must run AFTER 20260722_coaching_notes.sql (the table
-- + coach-owner policy); the filename sorts after it.

CREATE POLICY "coaching_notes_client_read_shared"
  ON public.coaching_notes FOR SELECT
  USING (
    client_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid())
    AND visibility = 'shared'
  );
