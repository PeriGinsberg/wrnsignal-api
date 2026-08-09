-- 20260809_coaching_notes_application_key.sql
--
-- Re-key coaching notes on the APPLICATION rather than the scoring run.
--
-- WHY. Notes were keyed on jobfit_run_id, so a job typed in by hand — which has
-- no run — could not have notes at all. The UI said "Notes open up once this job
-- has been scored by SIGNAL", which read as a rule about scoring and was really
-- a rule about storage. Every hand-added job hit it, and hand-adding is the path
-- for anything not scanned.
--
-- Removing only the UI gate would have been worse than leaving it: with no run,
-- the POST would write jobfit_run_id = NULL and the GET would query
-- `= NULL`, which in SQL matches nothing. Notes would save and vanish. So the
-- key moves first and the gate comes out last, in its own commit.
--
-- jobfit_run_id STAYS, as provenance and as the fallback read path while
-- confidence builds. Nothing about the existing notes is rewritten.

-- ── 1. The new key ──
--
-- Nullable, because the backfill cannot reach every row (see step 3) and a NOT
-- NULL here would fail the migration on live data. CASCADE because a note about
-- a job has no meaning once the job is gone — and see the note at the bottom
-- about what that does and does not fix.
ALTER TABLE public.coaching_notes
  ADD COLUMN IF NOT EXISTS application_id UUID
    REFERENCES public.signal_applications(id) ON DELETE CASCADE;

-- Mirrors idx_coaching_notes_job_artifact, which is on (jobfit_run_id,
-- artifact_type). Both reads filter on the key AND the artifact type, so the
-- new key needs its own composite or every read after the switch is a scan.
CREATE INDEX IF NOT EXISTS idx_coaching_notes_application_artifact
  ON public.coaching_notes (application_id, artifact_type);

-- ── 2. Backfill ──
--
-- One application per run in practice, but the schema does not guarantee it, so
-- this takes the OLDEST application for a run rather than an arbitrary one. A
-- non-deterministic backfill would be a silent data decision.
UPDATE public.coaching_notes n
   SET application_id = pick.id
  FROM (
    SELECT DISTINCT ON (jobfit_run_id) jobfit_run_id, id
      FROM public.signal_applications
     WHERE jobfit_run_id IS NOT NULL
     ORDER BY jobfit_run_id, created_at ASC
  ) pick
 WHERE n.jobfit_run_id = pick.jobfit_run_id
   AND n.application_id IS NULL;

-- ── 3. Relax the old key ──
--
-- REQUIRED, not cosmetic: jobfit_run_id is NOT NULL today, so a note on a
-- hand-added job — the entire point of this change — cannot be inserted at all
-- while that constraint stands. This is the one part of this migration that is
-- not additive.
ALTER TABLE public.coaching_notes
  ALTER COLUMN jobfit_run_id DROP NOT NULL;

-- ── What this migration does NOT do ──
--
-- ORPHANS ARE LEFT BEHIND, deliberately. A note whose run has no application
-- backfills to NULL and stays unreachable. On prod that is 2 of 2 rows — one
-- reading "Testing coaches notes", one a single line to a client — both already
-- unreachable before this change, since every route resolves
-- application -> run -> notes. Reviewed 2026-08-09 and judged not worth a
-- rescue. Dev has 0.
--
-- IT DOES NOT FIX THE ORPHANING PATH. Deleting an application still destroys
-- the coach notes attached to it — silently, and now via CASCADE rather than by
-- stranding them. That is arguably more honest and still gives nobody any
-- warning. Diagnosed and logged as its own item in
-- docs/silent-write-failures.md ("A third shape: the write survives, the way to
-- reach it does not"). Not fixed here.
--
-- DEV: applied 2026-08-09.
-- PROD: pending. Fifth on the promotion list and last of the five — it is the
-- only one that relaxes a constraint on a table holding live coach-written
-- content, and the only one whose CODE must land in a fixed order relative to
-- it (routes switch first, UI gate comes out last).
