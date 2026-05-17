// lib/positioning/v2/phase2/itemPopulator.ts
//
// Derives the initial PhaseTwoItem[] for a new phase2_run from the parent
// positioning_run_v2 row + upstream jobfit_run.result_json + case_specific
// data. Called at phase2_run creation time by the POST
// /api/positioning/v2/phase2/start endpoint (FRD §6.5.1).
//
// FRD: docs/Features/positioning-phase2-frd.md
//   §6.2 — item population rules
//   §4.3 — no filler principle
// Types: ./types.ts (PhaseTwoItem discriminated union)
// Parent types: @/lib/positioning/v2/types (PositioningRunV2Row,
//               JobfitResultJson, CaseSpecificData)
//
// SKELETON — Phase 2a commit. Real population logic (headline / bullet /
// gap derivation + filter rules per §6.2) lands in a later Stage 2
// commit. Stub returns [] so callers (POST /start handler, future tests)
// can wire up safely without behavior changes.

import type {
  JobfitResultJson,
  PositioningRunV2Row,
  CaseSpecificData,
} from "@/lib/positioning/v2/types"
import type { PhaseTwoItem } from "./types"

/**
 * Build the initial PhaseTwoItem[] for a new phase2_run.
 *
 * FRD §6.2 item population rules:
 *   - Headline (0 or 1): derived from positioningRun.case_specific
 *     .headline_recommendation if present.
 *     NOTE: `headline_recommendation` does not yet exist on the
 *     CaseSpecificData type defined in lib/positioning/v2/types.ts.
 *     A later Phase 2 commit will extend that type and the upstream
 *     caseSpecific.ts generator to populate it. The skeleton accepts
 *     CaseSpecificData (current shape) and ignores it.
 *   - Bullets (0-N): derived from jobfit.risk_structured entries tagged
 *     as bullet-addressable.
 *   - Gaps (0-N): derived from JD-required gaps where the resume has
 *     adjacent-but-unsurfaced evidence (typically a subset of risks).
 *
 * Filter rules (§4.3 no-filler principle):
 *   - Surface if: risk severity is `high` OR score-impact > threshold
 *     (initial: 5 points)
 *   - Skip if: cosmetic risk (no associated JD requirement),
 *     formatting nit, or already-addressed-by-prior-item
 *
 * Item ordering on selection screen (§6.2 default):
 *   1. Headline first (if any)
 *   2. Bullets ordered by impact desc
 *   3. Gaps ordered by impact desc
 *
 * Edge cases:
 *   - Case A positioning_run: typically returns [] (Case A users gated
 *     out of Phase 2 in v0.1 per FRD §5.1; defensive empty array for
 *     forward compat)
 *   - jobfit with no risks AND no whys: returns []
 *   - case_specific is null: skip the headline item but still process
 *     bullets and gaps from jobfit
 *
 * @param positioningRun The parent positioning_run_v2 row this phase2_run
 *                       attaches to. Provides case context + linked
 *                       jobfit_run_id.
 * @param jobfit The jobfit_run.result_json that drove case assignment.
 *               Source of risks + whys that become bullet/gap items.
 * @param caseSpecific The case_specific data computed at Phase 1 /start
 *                     time. Source of headline_recommendation (once that
 *                     field is added to CaseSpecificData). May be null
 *                     when the parent positioning_run was created without
 *                     case_specific data.
 * @returns Ordered array of PhaseTwoItem ready to seed phase2_runs.state.items.
 *          Empty array is a valid result (see edge cases).
 */
export function populateItems(
  positioningRun: PositioningRunV2Row,
  jobfit: JobfitResultJson,
  caseSpecific: CaseSpecificData | null,
): PhaseTwoItem[] {
  // TODO(phase-2-stage-2b): implement per FRD §6.2.
  // Skeleton returns [] so callers can integrate without behavior change.
  // Suppress unused-param warnings; real impl will read all three inputs.
  void positioningRun
  void jobfit
  void caseSpecific
  return []
}
