// lib/profile/computeStatus.ts
//
// Code-side student-vs-graduated verdict for the wrong-status fix.
// Replaces LLM inference (which was producing "As a senior at X" for users
// who had already graduated) with a deterministic computation from a
// graduation date and a current Date.
//
// Pure function. No I/O. Takes a parsed grad date + an optional
// candidate_targeting career_stage fallback + an optional injectable
// today (tests use it; production omits and gets real Date).
//
// Bucket policy: TWO buckets (`student` / `graduated`) plus `unknown`
// when no signal is available. The graduating-this-month case folds into
// `graduated` per the locked product decision (the failure mode of
// mis-calling a real grad a current student reads worse than mis-calling
// a recent grad a graduate).
//
// Fallback chain (in priority order):
//   1. Parsed grad date — most authoritative when present.
//   2. candidate_targeting.career_stage — intake-time self-identification.
//   3. "unknown" — no signal; caller emits "unknown" in the prompt and
//      the LLM falls back to its prior inference behavior (today's bug
//      remains for these cases, but they should be rare with grad date
//      extraction in front).
//
// Used by:
//   - app/api/coverletter/route.ts (Commit 3) — branches the OPENING
//     RULE on the verdict.
//   - app/api/networking/route.ts (Commit 4) — anchors the framing /
//     strategy fields.

import type { ParsedGradDate } from "@/lib/resume/extractGraduationDate"
import type { CareerStage } from "@/lib/laneTaxonomy"

// ============================================================================
// Types
// ============================================================================

export type CandidateStatus = "student" | "graduated" | "unknown"

export type ComputeStatusInput = {
  /** Parsed grad date from extractGraduationDate. Null when extraction returned no date. */
  gradDate: ParsedGradDate | null
  /** Fallback layer: candidate_targeting.career_stage. Null when no candidate_targeting row exists. */
  careerStage: CareerStage | null
  /**
   * Injectable "today" for deterministic testing. Production callers omit
   * this and get real-time `new Date()`. Tests always inject to avoid
   * time-dependent assertions.
   */
  today?: Date
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve a candidate's lifecycle status from a graduation date plus a
 * candidate_targeting career_stage fallback.
 *
 * Decision matrix:
 *
 *   Layer 1 — grad date (when present, always wins over career_stage):
 *     grad year > today year                    → student
 *     grad year < today year                    → graduated
 *     same year, grad month > today month       → student
 *     same year, grad month <= today month      → graduated (folds same-month)
 *     same year, no month:
 *       type === "expected"                     → student
 *       type === "completed" or "unknown"       → graduated  [EDIT 1]
 *
 *   Layer 2 — career_stage (when no grad date):
 *     "student"                                  → student
 *     "early_career" / "mid_career" / "executive" → graduated
 *
 *   Layer 3 — neither signal present:
 *     null gradDate + null careerStage          → unknown
 *
 * Boundary rationale:
 * - Same-year same-month → graduated. By the time the user sends the
 *   letter, "current student" reads wrong; "recent graduate" reads right
 *   for both this-week and last-week cases.
 * - Same-year, year-only, type "unknown" → graduated [EDIT 1]. In genuine
 *   ambiguity, err toward "graduated" — the failure mode of mis-calling a
 *   real grad a current student is worse than the reverse.
 *
 * Pure function — no I/O. Safe to call from any route or test.
 */
export function computeStatus(input: ComputeStatusInput): CandidateStatus {
  const today = input.today ?? new Date()
  const todayYear = today.getFullYear()
  // getMonth() is 0-indexed (0 = January); ParsedGradDate.month is 1-indexed.
  // Normalize to 1-indexed for the comparison.
  const todayMonth = today.getMonth() + 1

  // Layer 1: grad date (most authoritative)
  const g = input.gradDate
  if (g) {
    if (g.year > todayYear) return "student"
    if (g.year < todayYear) return "graduated"

    // Same year — month decides if present, type decides otherwise.
    if (g.month !== null) {
      return g.month > todayMonth ? "student" : "graduated"
      // grad.month === today.month folds into "graduated" — see header
    }

    // Year-only, same year. type === "expected" means future-intent ("Class
    // of 2026" with anticipated framing); type "completed" or "unknown"
    // both fold into "graduated" per EDIT 1.
    if (g.type === "expected") return "student"
    return "graduated"
  }

  // Layer 2: career_stage fallback (intake-time self-identification)
  if (input.careerStage === "student") return "student"
  if (
    input.careerStage === "early_career" ||
    input.careerStage === "mid_career" ||
    input.careerStage === "executive"
  ) {
    return "graduated"
  }

  // Layer 3: no signal — caller emits "unknown" in the prompt and the LLM
  // falls back to its own inference (today's behavior).
  return "unknown"
}
