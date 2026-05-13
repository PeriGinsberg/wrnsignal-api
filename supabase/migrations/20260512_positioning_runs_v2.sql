-- 20260512_positioning_runs_v2.sql
--
-- Phase 1 — create positioning_runs_v2 table for Positioning v2.
--
-- FRD: docs/Features/positioning-phase1-frd.md (section 4.3)
-- Runlog: docs/Features/foundation-migration-runlog.md
-- Types: lib/positioning/v2/types.ts
--   PositioningRunV2Row + PositioningRunV2InsertPayload must stay in lockstep
--   with this schema. CHECK enum lists mirror the literal unions defined there
--   (Case = 'A'|'B'|'C', current_phase 1..5, status =
--   'in_progress'|'completed'|'abandoned').
--
-- updated_at trigger uses the existing public.set_updated_at() function
-- (NOT update_updated_at_column — see runlog DD-07).
--
-- Foreign keys:
--   - profile_id: ON DELETE CASCADE (cleanup when a profile is deleted)
--   - persona_id, jobfit_run_id, signal_application_id: NO ACTION default
--     (preserve runs as historical record even if upstream rows are deleted;
--     signal_application_id is populated via the two-write pattern in
--     /api/positioning/v2/start, so it's nullable at INSERT time)
--
-- DEV ENV ONLY first. Apply via Supabase SQL Editor (Path B per Foundation
-- precedent — dev's schema_migrations tracker is in the documented broken
-- state, so supabase db push isn't reliable here). Prod promotion is a
-- separate explicit step Peri triggers. Document execution in runlog.

CREATE TABLE public.positioning_runs_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership
  profile_id UUID NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  persona_id UUID NOT NULL REFERENCES public.client_personas(id),

  -- Linked artifacts (nullable; signal_application_id is set after INSERT
  -- via the two-write pattern, see FRD section 4.2 / Phase 1 plan F4)
  jobfit_run_id         UUID REFERENCES public.jobfit_runs(id),
  signal_application_id UUID REFERENCES public.signal_applications(id),

  -- Snapshot of the job that triggered this run
  job_title       TEXT NOT NULL,
  job_company     TEXT NOT NULL,
  job_url         TEXT,
  job_description TEXT NOT NULL,

  -- Case determination output (case_reasoning is logged for post-launch
  -- tuning per FRD section 7)
  case_assigned  TEXT NOT NULL,
  case_reasoning TEXT NOT NULL,

  -- Workflow state
  current_phase INTEGER NOT NULL DEFAULT 1,
  phase_data    JSONB   NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT    NOT NULL DEFAULT 'in_progress',

  -- Deterministic identity for this (profile, persona, JD, targeting state)
  -- See FingerprintInputs in lib/positioning/v2/types.ts
  fingerprint_hash TEXT NOT NULL,
  fingerprint_code TEXT NOT NULL,

  -- Final result snapshot. NULL until status='completed'.
  result_json JSONB,

  -- Timestamps
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMPTZ,

  -- case_assigned mirrors Case literal union in types.ts
  CONSTRAINT case_assigned_validation CHECK (
    case_assigned IN ('A', 'B', 'C')
  ),

  -- current_phase mirrors 1..5 literal union in types.ts
  CONSTRAINT current_phase_validation CHECK (
    current_phase BETWEEN 1 AND 5
  ),

  -- status mirrors PositioningRunV2Status literal union in types.ts
  CONSTRAINT status_validation CHECK (
    status IN ('in_progress', 'completed', 'abandoned')
  )
);

-- Lookup by profile (most common query: "show me this profile's runs")
CREATE INDEX idx_positioning_runs_v2_profile_id
  ON public.positioning_runs_v2 (profile_id);

-- Reverse-lookup from a JobFit run to its positioning_run (deduplication
-- + analytics joins)
CREATE INDEX idx_positioning_runs_v2_jobfit_run_id
  ON public.positioning_runs_v2 (jobfit_run_id);

-- Status filtering ("show me in-progress runs", abandoned-run cleanup)
CREATE INDEX idx_positioning_runs_v2_status
  ON public.positioning_runs_v2 (status);

-- Fingerprint lookup for idempotency on /start (find-or-create pattern)
CREATE INDEX idx_positioning_runs_v2_fingerprint
  ON public.positioning_runs_v2 (fingerprint_hash);

-- Join to signal_applications (populated after the two-write pattern)
CREATE INDEX idx_positioning_runs_v2_signal_application
  ON public.positioning_runs_v2 (signal_application_id);

-- updated_at maintenance via existing trigger function (Foundation DD-07)
CREATE TRIGGER trg_positioning_runs_v2_set_updated_at
  BEFORE UPDATE ON public.positioning_runs_v2
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
