-- Prep Now, commit 1: schema only. ADDITIVE — no behaviour change, no code
-- change, no data migration, no existing column altered in type, default or
-- nullability. Every new column is NULL-able or carries a default, so existing
-- rows stay valid and every current reader keeps working untouched.
--
-- Context (recon 2026-08-05): signal_interviews has no time-of-day and no
-- format. `interview_stage` currently conflates ROUND (hr_screening,
-- final_round, take_home) with MEDIUM (phone, zoom, in_person), so
-- "final round, in person" is unrepresentable. This migration adds the missing
-- axes beside the existing ones rather than reinterpreting them.

-- ---------------------------------------------------------------------------
-- 1. interview_at — the canonical scheduling field
-- ---------------------------------------------------------------------------
-- `interview_date` is a `date`, so an interview at 2pm and one at 9am are
-- indistinguishable, and anything time-relative ("prep 2 hours before") is
-- inexpressible. A `date` also has no instant, which is the root of the
-- day-early rendering bug fixed in lib/localDate.ts; a timestamptz avoids that
-- class entirely.
--
-- interview_date is deliberately NOT dropped, NOT backfilled and NOT altered.
-- It stays as the field every existing reader uses. Backfill and cutover are
-- later commits with their own decisions.
ALTER TABLE public.signal_interviews
  ADD COLUMN IF NOT EXISTS interview_at timestamptz;

COMMENT ON COLUMN public.signal_interviews.interview_at IS
  'Canonical scheduled instant. Supersedes interview_date (date, no time-of-day). Both coexist until cutover; interview_date remains authoritative for existing readers.';

-- ---------------------------------------------------------------------------
-- 2. interview_format — medium, separated from round
-- ---------------------------------------------------------------------------
-- NULL is a real state and the default: it means "not recorded", which is true
-- of every existing row. The CHECK admits NULL explicitly so existing rows pass.
ALTER TABLE public.signal_interviews
  ADD COLUMN IF NOT EXISTS interview_format text;

ALTER TABLE public.signal_interviews
  DROP CONSTRAINT IF EXISTS signal_interviews_interview_format_check;

ALTER TABLE public.signal_interviews
  ADD CONSTRAINT signal_interviews_interview_format_check
  CHECK (interview_format IS NULL OR interview_format IN
    ('in_person','virtual','phone','take_home'));

COMMENT ON COLUMN public.signal_interviews.interview_format IS
  'Medium of the interview, independent of interview_stage (the round). NULL = not recorded.';

-- ---------------------------------------------------------------------------
-- 3. interviewers — structured, alongside the free-text field
-- ---------------------------------------------------------------------------
-- Shape: [{ "name": text, "title": text, "linkedin_url": text }, ...]
-- interviewer_names (text) is NOT dropped and NOT migrated. Two writers for one
-- concept is a known cost, accepted here so this commit stays additive; the
-- reconciliation is its own commit.
--
-- No CHECK on the array shape. A jsonb CHECK cannot express the element schema
-- without a function, and a half-enforced constraint is worse than none —
-- validation belongs at the API boundary.
ALTER TABLE public.signal_interviews
  ADD COLUMN IF NOT EXISTS interviewers jsonb;

COMMENT ON COLUMN public.signal_interviews.interviewers IS
  'Array of {name, title, linkedin_url}. Coexists with interviewer_names (free text); neither is authoritative yet.';

-- ---------------------------------------------------------------------------
-- 4. interview_stage — admit 'ai_hirevue'
-- ---------------------------------------------------------------------------
-- The UI has offered "AI / HireVue" since the tracker was built
-- (app/dashboard/tracker/vocab.ts), but the CHECK from 20260403_job_tracker.sql
-- never included it, so selecting it fails at write time.
--
-- The constraint being dropped was read from pg_constraint on dev before this
-- was written. Verbatim, it is the ONLY check on the table referencing this
-- column:
--
--   signal_interviews_interview_stage_check
--   CHECK ((interview_stage = ANY (ARRAY['hr_screening'::text, 'phone'::text,
--     'zoom'::text, 'in_person'::text, 'take_home'::text, 'final_round'::text,
--     'other'::text])))
--
-- All seven values are preserved below; 'ai_hirevue' is the only addition, and
-- it is placed after 'zoom' to match the order the UI lists them in. A CHECK
-- cannot be altered in place, hence drop and re-add.
--
-- Deliberately NOT `IF EXISTS`: the constraint has been observed, so its
-- absence would mean the database is not in the state this migration was
-- written against, and failing loudly is the correct outcome. `IF EXISTS` here
-- would only buy silence — it would no-op, leave the old narrower constraint in
-- force, and the migration would report success while 'ai_hirevue' still failed.
ALTER TABLE public.signal_interviews
  DROP CONSTRAINT signal_interviews_interview_stage_check;

ALTER TABLE public.signal_interviews
  ADD CONSTRAINT signal_interviews_interview_stage_check
  CHECK (interview_stage IN (
    'hr_screening','phone','zoom','ai_hirevue','in_person',
    'take_home','final_round','other'));

-- ---------------------------------------------------------------------------
-- 5. interview_prep_runs
-- ---------------------------------------------------------------------------
-- One row per generated prep pass for one interview.
--
-- jobfit_run_id is NULLABLE on purpose, not as a convenience: measured on dev,
-- roughly a third of applications carry a signal_score with no jobfit_run_id
-- (coach-sourced jobs copy the score across; rows predating the FK never had
-- one). A prep run must be able to exist with no analysis behind it.
-- ON DELETE SET NULL matches signal_applications.jobfit_run_id, so deleting a
-- run degrades the prep rather than destroying it.
--
-- profile_id is denormalised from the interview so ownership checks and RLS do
-- not need a join. It mirrors signal_interviews, which does the same.
--
-- checklist_state is NOT NULL DEFAULT '{}' because "no items ticked" is a real,
-- representable state and NULL would add a second meaning for the same thing.
-- `generated` is nullable: a row may exist before generation completes.
CREATE TABLE IF NOT EXISTS public.interview_prep_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id     uuid NOT NULL REFERENCES public.signal_interviews(id) ON DELETE CASCADE,
  profile_id       uuid NOT NULL REFERENCES public.client_profiles(id)  ON DELETE CASCADE,
  jobfit_run_id    uuid          REFERENCES public.jobfit_runs(id)      ON DELETE SET NULL,
  content_hash     text,
  generated        jsonb,
  checklist_state  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_prep_runs_interview_id
  ON public.interview_prep_runs(interview_id);
CREATE INDEX IF NOT EXISTS idx_interview_prep_runs_profile_id
  ON public.interview_prep_runs(profile_id);

COMMENT ON COLUMN public.interview_prep_runs.content_hash IS
  'Fingerprint of the inputs a prep was generated from, so an unchanged interview can reuse rather than regenerate.';
COMMENT ON COLUMN public.interview_prep_runs.jobfit_run_id IS
  'Optional. ~1/3 of applications have a score with no run, so prep must work without one.';

-- updated_at maintenance via the existing shared trigger function. Confirmed
-- present on dev before this was written: public.set_updated_at(), no
-- arguments, returns trigger. Same function as
-- trg_positioning_runs_v2_set_updated_at and trg_coach_notes_set_updated_at.
DROP TRIGGER IF EXISTS trg_interview_prep_runs_set_updated_at ON public.interview_prep_runs;
CREATE TRIGGER trg_interview_prep_runs_set_updated_at
  BEFORE UPDATE ON public.interview_prep_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PostgREST caches the schema. Without this the new columns and the widened
-- CHECK are rejected at the API layer even though the database accepts them.
NOTIFY pgrst, 'reload schema';
