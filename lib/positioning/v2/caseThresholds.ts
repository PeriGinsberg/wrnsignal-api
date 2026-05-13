// lib/positioning/v2/caseThresholds.ts
//
// Threshold constants for Phase 1 case determination. Per FRD section 4.1,
// thresholds live in code config rather than DB so changes are
// version-controlled. Tuning is a code change.
//
// FRD: docs/Features/positioning-phase1-frd.md (section 4.1)
//
// Consumed by:
//   - lib/positioning/v2/caseDetermination.ts (the determineCase function)
//
// Tuning notes (from FRD section 7 Risk: Case determination accuracy):
//   - case_reasoning is logged on every positioning_run_v2 for post-launch
//     analysis. Distribution of assignments + reasoning strings drives tuning.
//   - Plan to revisit these thresholds after 1-2 weeks of production data.
//   - Manual sampling of case assignments during dev testing recommended.

/**
 * Minimum number of positive findings (why_structured entries) required
 * for a profile with verdict=Apply or Priority Apply AND zero risks to
 * qualify for Case A (well-positioned).
 *
 * Below this count, the candidate defaults to Case B even with no surfaced
 * risks — the rationale is that "few risks AND few strengths" suggests
 * JobFit didn't have enough to say, not that the candidate is clearly
 * well-positioned. Surfacing Case A's "your resume is well-positioned"
 * framing on thin evidence is worse than the slightly heavier Case B
 * framing because it sets up disappointment if the application doesn't
 * land.
 *
 * Lower values are more permissive (more Case A assignments).
 * Higher values are more conservative (fewer Case A assignments).
 *
 * Initial value: 3. Tunable per FRD section 7.
 */
export const CASE_A_MIN_WHY_COUNT = 3

/**
 * Controls whether a Review verdict with any high-severity risk forces
 * Case C (significant repositioning required) rather than Case B
 * (targeted changes needed).
 *
 *   - true  (current): Review + any high-severity risk → Case C
 *   - false:           Review always → Case B regardless of risk severity
 *
 * Initial value: true. This is the conservative default — surfacing
 * "significant repositioning" framing when JobFit's already-Review verdict
 * is accompanied by high-severity risk reflects the actual scope of work
 * the candidate is signing up for.
 *
 * Note: high-severity risk on Apply / Priority Apply verdicts uses a
 * different rule (forces Case B, NOT Case C) — see caseDetermination.ts.
 * This flag only applies to the Review branch.
 *
 * Tunable per FRD section 7.
 */
export const CASE_C_HIGH_SEVERITY_TRIGGER = true
