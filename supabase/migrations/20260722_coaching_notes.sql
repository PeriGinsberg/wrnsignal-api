-- 20260722_coaching_notes.sql
--
-- Coach-notes feature, step 1: the table only (no API/UI yet).
--
-- A per-job notes store designed for a future TWO-WAY thread (coach <-> client),
-- though phase 1 uses only part of it: phase 1 writes are coach-authored,
-- top-level (no replies), and the coach chooses each note's visibility.
--
-- Attachment/link model: a note hangs off a JOB, keyed by jobfit_run_id — the
-- same link key the coach Job Tracker + detail panel already match on. Cover-
-- letter notes key off the job's jobfit_run_id too (artifact_type distinguishes
-- them), so every note for a given job groups together regardless of artifact.
--
-- Phase 2 (future) adds client-authored replies and a client read that only
-- ever surfaces visibility='shared' notes.
--
-- Additive only: creates one new table + two indexes. No existing table is
-- altered. The new foreign keys point at existing tables (client_profiles,
-- jobfit_runs); adding an FK from a brand-new table does not modify them.
--
-- Reversibility:
--   DROP TABLE public.coaching_notes;
-- (Safe — nothing else references it.)
--
-- DEV ENV ONLY first. Apply via Supabase SQL Editor; prod promotion is a
-- separate explicit step.

CREATE TABLE IF NOT EXISTS public.coaching_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The COACH author, always set from the authenticated session, never from the
  -- request body. NULL only for a future client-authored note (author_role =
  -- 'client'); phase 1 is always a coach write, so this is always populated now.
  coach_profile_id UUID REFERENCES public.client_profiles(id),

  -- The client the note is about — the artifact owner. Always set.
  client_profile_id UUID NOT NULL REFERENCES public.client_profiles(id),

  -- Which SIGNAL artifact this note is about.
  artifact_type TEXT NOT NULL
    CHECK (artifact_type IN ('jobfit', 'coverletter')),

  -- The job this note is attached to: the jobfit_run_id link key. Cover-letter
  -- notes also key off the job's jobfit_run_id so a job's notes group together.
  jobfit_run_id UUID NOT NULL REFERENCES public.jobfit_runs(id),

  -- Who wrote this note, snapshotted at write time for the future thread.
  -- Phase 1 writes are always 'coach'.
  author_role TEXT NOT NULL
    CHECK (author_role IN ('coach', 'client')),

  -- Future replies (self-referential thread). NULL for a top-level note;
  -- phase 1 is always NULL. Deleting a parent removes its replies.
  parent_note_id UUID REFERENCES public.coaching_notes(id) ON DELETE CASCADE,

  body TEXT NOT NULL,

  -- The coach chooses this at write time in phase 1. The future client read
  -- (phase 2) will only ever be shown 'shared' notes. Defaults to 'private'
  -- so an unspecified write never leaks to the client.
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'shared')),

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Integrity: a coach-authored note must carry its coach author; a client-
  -- authored note carries none (its author is client_profile_id).
  CONSTRAINT coaching_notes_coach_author_present
    CHECK (author_role <> 'coach' OR coach_profile_id IS NOT NULL)
);

-- Primary panel fetch: "all notes for this job's jobfit / cover letter."
CREATE INDEX IF NOT EXISTS idx_coaching_notes_job_artifact
  ON public.coaching_notes (jobfit_run_id, artifact_type);

-- Per-client, visibility-filtered lookups (feeds the phase-2 client read of
-- 'shared' notes, and coach-side per-client filtering).
CREATE INDEX IF NOT EXISTS idx_coaching_notes_client_visibility
  ON public.coaching_notes (client_profile_id, visibility);

-- Row-level security — belt-and-suspenders, matching coach_client_notes. The
-- API does the real authz (service-role + bearer token + verifyCoachAccess);
-- this policy guards against direct DB access.
ALTER TABLE public.coaching_notes ENABLE ROW LEVEL SECURITY;

-- Phase 1: a coach can see/write only their own notes.
CREATE POLICY "coaching_notes_coach_owner_access"
  ON public.coaching_notes FOR ALL
  USING (
    coach_profile_id = (
      SELECT id FROM client_profiles WHERE user_id = auth.uid()
    )
  );

-- DEFERRED to phase 2 (client view): a SELECT-only policy letting a client read
-- shared notes about them, e.g.
--   CREATE POLICY "coaching_notes_client_read_shared"
--     ON public.coaching_notes FOR SELECT
--     USING (
--       client_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid())
--       AND visibility = 'shared'
--     );
-- Not added yet — phase 1 has no client read.
