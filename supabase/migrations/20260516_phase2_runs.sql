-- 20260516_phase2_runs.sql
--
-- Phase 2 — create phase2_runs table for Positioning v2 Resume Reframing
-- Workflow.
--
-- FRD: docs/Features/positioning-phase2-frd.md (section 6.1)
-- Runlog: docs/Features/foundation-migration-runlog.md
-- Types: lib/positioning/v2/phase2/types.ts
--   PhaseTwoRunRow + PhaseTwoRunInsertPayload must stay in lockstep with
--   this schema. CHECK enum lists mirror the literal unions defined there
--   (Case = 'A'|'B'|'C', PhaseTwoRunStatus =
--   'in_progress'|'completed'|'abandoned').
--
-- updated_at trigger uses the existing public.set_updated_at() function
-- (NOT update_updated_at_column — see runlog DD-07).
--
-- Foreign keys:
--   - positioning_run_id: ON DELETE CASCADE (Phase 2 state is meaningless
--     without its parent positioning_run; cascade cleanup when parent is
--     deleted)
--   - profile_id: NO ACTION default (preserve as historical record; the
--     parent positioning_run's ON DELETE CASCADE on profile_id already
--     covers the profile-deletion case via the positioning_run cascade)
--   - persona_id: NO ACTION default (preserve runs even if persona is
--     deleted; persona deletion is rare and historical runs remain valuable)
--   - new_persona_id: NO ACTION default. Nullable at INSERT time —
--     populated only when the user opts to save the revised resume as a
--     new persona at workflow completion (FRD section 6.5.5).
--
-- ai_cost_cents tracks AI generation cost per run for the section 6.12 cap
-- enforcement and post-launch cost dashboard. Included in this initial
-- migration rather than added separately (FRD section 7 Phase 2a lists it
-- as a separate step; consolidating here avoids a second migration for
-- one column).
--
-- DEV ENV ONLY first. Apply via Supabase SQL Editor (Path B per Foundation
-- precedent — dev's schema_migrations tracker is in the documented broken
-- state, so supabase db push isn't reliable here). Prod promotion is a
-- separate explicit step Peri triggers. Document execution in runlog.

CREATE TABLE public.phase2_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent positioning_run + ownership
  positioning_run_id UUID NOT NULL REFERENCES public.positioning_runs_v2(id) ON DELETE CASCADE,
  profile_id         UUID NOT NULL REFERENCES public.client_profiles(id),
  persona_id         UUID NOT NULL REFERENCES public.client_personas(id),

  -- Snapshot of which case the parent positioning_run was assigned. Stored
  -- here for query convenience (avoids a join when filtering Phase 2 runs
  -- by case) and to preserve the case context if the parent's case_assigned
  -- ever changes (currently it shouldn't, but defensive snapshot).
  case_letter TEXT NOT NULL,

  -- Workflow state (full session JSONB; see FRD section 6.3 for schema)
  state JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Composed revised resume — updated on every accept/edit via the
  -- deterministic recomposition in resumeComposer.ts (FRD section 6.10).
  -- NULL until the user accepts their first item.
  revised_resume_text TEXT,

  -- Persona save. NULL until the user completes the workflow AND opts to
  -- save (FRD section 6.5.5). When set, references the newly-created
  -- client_personas row.
  new_persona_id UUID REFERENCES public.client_personas(id),

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'in_progress',

  -- AI cost tracking for per-run cap enforcement (FRD section 6.12).
  -- Stored in cents to avoid float precision issues. Incremented on every
  -- /draft endpoint call.
  ai_cost_cents INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMPTZ,

  -- case_letter mirrors Case literal union in lib/positioning/v2/types.ts
  CONSTRAINT case_letter_validation CHECK (
    case_letter IN ('A', 'B', 'C')
  ),

  -- status mirrors PhaseTwoRunStatus literal union in
  -- lib/positioning/v2/phase2/types.ts
  CONSTRAINT status_validation CHECK (
    status IN ('in_progress', 'completed', 'abandoned')
  ),

  -- ai_cost_cents cannot be negative
  CONSTRAINT ai_cost_cents_non_negative CHECK (
    ai_cost_cents >= 0
  )
);

-- Lookup by parent positioning_run (most common query: "show me the Phase 2
-- run for this positioning_run")
CREATE INDEX idx_phase2_runs_positioning_run_id
  ON public.phase2_runs (positioning_run_id);

-- Lookup by profile (analytics, "show me all Phase 2 runs by this profile")
CREATE INDEX idx_phase2_runs_profile_id
  ON public.phase2_runs (profile_id);

-- Status filtering ("show me in-progress runs", abandoned-run cleanup)
CREATE INDEX idx_phase2_runs_status
  ON public.phase2_runs (status);

-- updated_at maintenance via existing trigger function (Foundation DD-07)
CREATE TRIGGER trg_phase2_runs_set_updated_at
  BEFORE UPDATE ON public.phase2_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
