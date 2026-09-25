-- ═══════════════════════════════════════════════════
-- Keep the plan's source rows, so Build does not need the file again — 2026-09-26
-- ═══════════════════════════════════════════════════
--
-- IN PLAIN ENGLISH
--
-- A Networking Plan is built from the "Outreach Messages" tab of the uploaded
-- workbook. The import stores the CONTACTS from that workbook, and the
-- companies, and the actions. It has never stored those message rows.
--
-- So the only moment a plan could be built was the moment of upload, while the
-- file was still in the browser's memory. Click away to look at the imported
-- contacts and Build Networking Plan is unreachable: the coach has to find and
-- upload the workbook a second time to get back to a button that was on screen
-- a moment ago.
--
-- This stores the rows at upload, so Build is a thing a coach can come back to.
--
-- ONE CURRENT SOURCE PER CLIENT, replaced on each upload rather than appended.
-- The plan is built from the latest workbook; keeping every version would mean
-- deciding which one Build means, and nothing asks that question. The old rows
-- are not history worth keeping, because the plan they produced IS the history
-- and it is in Drive.
--
-- Reversibility:
--   DROP TABLE public.networking_plan_sources;
--
-- Nothing else references it, and the plan-run path still accepts a file, so
-- dropping this returns the feature to upload-only.

CREATE TABLE IF NOT EXISTS public.networking_plan_sources (
  -- One row per coach-client relationship, which is what a plan belongs to.
  coach_client_id UUID PRIMARY KEY
    REFERENCES public.coach_clients(id) ON DELETE CASCADE,

  client_profile_id UUID NOT NULL REFERENCES public.client_profiles(id),

  -- The "Outreach Messages" rows, exactly as the parser produced them: an
  -- array of string arrays. Stored raw rather than parsed into columns because
  -- lib/networking-plan/planData.ts is the only thing that reads them and it
  -- wants the grid.
  rows JSONB NOT NULL,

  -- The same hash findOrCreateJob keys a job on, so the status endpoint can say
  -- whether the built plan matches the stored source without rebuilding it.
  source_hash TEXT NOT NULL,

  -- The workbook's filename, so the screen can say WHICH file this came from.
  -- A coach who uploaded two in a row should not have to guess.
  file_name TEXT,

  uploaded_by_id UUID REFERENCES public.client_profiles(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_networking_plan_sources_client
  ON public.networking_plan_sources (client_profile_id);

ALTER TABLE public.networking_plan_sources ENABLE ROW LEVEL SECURITY;

-- Service-role only, like the job table beside it. The routes do their own
-- scope check via resolveRequestScope; RLS on with no policy denies every anon
-- and authenticated request rather than leaving the rows readable.

NOTIFY pgrst, 'reload schema';
