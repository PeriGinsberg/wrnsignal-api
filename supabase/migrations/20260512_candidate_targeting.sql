-- 20260512_candidate_targeting.sql
--
-- Foundation Stage 1a — create candidate_targeting table for Positioning v2.
--
-- FRD: docs/Features/positioning-foundation-frd.md (section 4.2)
-- Runlog: docs/Features/foundation-migration-runlog.md
-- Taxonomy source: lib/laneTaxonomy.ts (CHECK constraint values mirror LANE_IDS)
--
-- Sub-lane validation lives at app layer (lib/laneTaxonomy.ts isValidSubLaneId
-- on top of LANES) — sub-lane columns are TEXT with no DB constraint, per
-- locked decision DD-05 (avoid migration burden as sub-lanes evolve).
--
-- updated_at trigger uses the existing public.set_updated_at() function
-- (NOT the FRD's assumed update_updated_at_column — see runlog DD-07).
--
-- DEV ENV ONLY. Apply via Supabase SQL Editor. Document execution in runlog.

CREATE TABLE public.candidate_targeting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,

  -- Primary targeting (required)
  primary_lane TEXT NOT NULL,
  primary_sublane TEXT,
  primary_other_description TEXT,

  -- Secondary targeting (optional, up to 2)
  secondary_lane_1 TEXT,
  secondary_sublane_1 TEXT,
  secondary_lane_2 TEXT,
  secondary_sublane_2 TEXT,

  -- Career stage
  career_stage TEXT NOT NULL,
  career_stage_locked_by TEXT NOT NULL,

  -- Status indicators
  status_premed  BOOLEAN DEFAULT FALSE NOT NULL,
  status_prelaw  BOOLEAN DEFAULT FALSE NOT NULL,
  status_pregrad BOOLEAN DEFAULT FALSE NOT NULL,

  -- Provenance
  source     TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- One targeting row per profile
  CONSTRAINT one_targeting_per_profile UNIQUE (profile_id),

  -- Primary lane must be one of the 12 locked values from lib/laneTaxonomy.ts
  CONSTRAINT primary_lane_validation CHECK (
    primary_lane IN (
      'consulting', 'finance', 'accounting', 'marketing',
      'sales_bd', 'technology', 'operations_strategy', 'healthcare',
      'people_hr', 'public_sector', 'legal', 'other'
    )
  ),

  -- Secondary lanes (if set) must also match the enum
  CONSTRAINT secondary_lane_1_validation CHECK (
    secondary_lane_1 IS NULL OR secondary_lane_1 IN (
      'consulting', 'finance', 'accounting', 'marketing',
      'sales_bd', 'technology', 'operations_strategy', 'healthcare',
      'people_hr', 'public_sector', 'legal', 'other'
    )
  ),
  CONSTRAINT secondary_lane_2_validation CHECK (
    secondary_lane_2 IS NULL OR secondary_lane_2 IN (
      'consulting', 'finance', 'accounting', 'marketing',
      'sales_bd', 'technology', 'operations_strategy', 'healthcare',
      'people_hr', 'public_sector', 'legal', 'other'
    )
  ),

  -- Career stage matches CAREER_STAGES in lib/laneTaxonomy.ts
  CONSTRAINT career_stage_validation CHECK (
    career_stage IN ('student', 'early_career', 'mid_career', 'executive')
  ),

  -- Provenance of the career_stage value
  CONSTRAINT career_stage_locked_by_validation CHECK (
    career_stage_locked_by IN ('intake', 'inferred', 'manual_override')
  ),

  -- Where the whole row came from
  CONSTRAINT source_validation CHECK (
    source IN ('intake', 'migration', 'manual_update')
  ),

  -- If primary_lane='other', primary_other_description must be non-empty
  CONSTRAINT other_description_required_for_other_lane CHECK (
    (primary_lane <> 'other')
    OR (primary_other_description IS NOT NULL
        AND LENGTH(TRIM(primary_other_description)) > 0)
  )
);

CREATE INDEX idx_candidate_targeting_profile_id
  ON public.candidate_targeting (profile_id);

CREATE INDEX idx_candidate_targeting_primary_lane
  ON public.candidate_targeting (primary_lane);

CREATE TRIGGER trg_candidate_targeting_set_updated_at
  BEFORE UPDATE ON public.candidate_targeting
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
