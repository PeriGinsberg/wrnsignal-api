// FILE: lib/jobfit/engineContract.ts
//
// METHODOLOGY-NATIVE ENGINE CONTRACT — target types for the JobFit rebuild.
//
// STATUS: STUB. Nothing consumes these yet. They are defined here so they
// compile alongside the live engine (app/api/jobfit/signals.ts) WITHOUT
// modifying it. The live engine keeps using its own signals.ts types until
// Stage 1+ wires these in.
//
// Design context (DECIDED, not for debate here):
//   - evaluate-once / project-twice: one EngineEvaluation, two LensProjections.
//   - two evaluated verdicts: Fit + Positioning.
//   - two-axis match model: skill_fit × industry_fit, graded, with a core flag,
//     and match_strength (direct/partial/gap) as a DERIVED read for the spine.
//   - KEEP the deterministic scoring spine + gate logic. Seam B (this file's
//     `Match`) must still emit every field the kept spine reads — see §2c of the
//     boundary map: match_strength, match_kind, weight (0-120), coverageScore
//     (0-100), match_key, code, job_unit, profile_unit, job_fact, profile_fact,
//     note.
//
// NAME COLLISION (intentional, flagged): signals.ts ALSO exports a type named
// `MatchStrength` (value union "direct" | "adjacent"). The `MatchStrength` below
// is a DIFFERENT type (3-value "direct" | "partial" | "gap"). They live in
// separate modules; this file does NOT import signals' MatchStrength, so there
// is no in-file clash. Any future module importing BOTH must alias one of them.

import type {
  Decision,
  GateTriggered,
  ScoreBreakdown,
  EvidenceKind,
  JobRequirementUnit,
  ProfileEvidenceUnit,
} from "@/app/api/jobfit/signals"

// ── Primitives ───────────────────────────────────────────────────────────────

// Per-axis grade for the two-axis match model.
export type AxisGrade = "strong" | "partial" | "absent"

// Role seniority, reconciled at evaluation time and used to interpret matches.
export type SeniorityLevel = "entry" | "mid" | "senior"

// DERIVED read handed to the kept scoring spine (Seam B). NOTE: the legacy
// "adjacent" is collapsed into "partial"; "gap" is new. Do NOT reintroduce
// "adjacent" here.
export type MatchStrength = "direct" | "partial" | "gap"

// ── Match (Seam B contract) ──────────────────────────────────────────────────
//
// The two-axis primitive plus every field the kept spine consumes. Field names,
// types, and numeric scales are held identical to the legacy WhyEvidenceMatch so
// the spine (buildCoverage / computeBaseScore / selectWhyMatches / penalty
// blocks) keeps working unchanged once it is fed `Match[]`.
export type Match = {
  // two-axis primitive (NEW)
  skill_fit: AxisGrade
  industry_fit: AxisGrade
  is_core: boolean

  // derived read for the scoring spine (Seam B contract)
  match_strength: MatchStrength

  // existing spine-consumed fields — exact names / types / scales preserved
  match_kind: EvidenceKind
  weight: number // 0-120 scale (guardrail thresholds calibrated to it)
  coverageScore: number // 0-100
  match_key: string
  code: string
  job_unit: JobRequirementUnit
  profile_unit: ProfileEvidenceUnit
  job_fact: string
  profile_fact: string
  note: string
}

// ── The two evaluated verdicts ───────────────────────────────────────────────

// Fit verdict — the deterministic scoring spine's output, now carrying the
// two-axis `Match[]` instead of WhyEvidenceMatch[].
export type FitVerdict = {
  decision: Decision
  score: number
  matches: Match[]
  gates: GateTriggered
  score_breakdown: ScoreBreakdown
}

// Positioning verdict — evaluated separately from fit. Booleans are the
// methodology's positioning checks; `perception` is the one-line read of how a
// reviewer would perceive the candidate; `in_the_way` is whether positioning is
// blocking an otherwise-viable fit.
export type PositioningVerdict = {
  declares_intent: boolean
  tells_one_story: boolean
  speaks_the_language: boolean
  perception: string
  in_the_way: boolean
}

// ── The single evaluation (evaluate-once) ────────────────────────────────────

export type EngineEvaluation = {
  fit: FitVerdict
  positioning: PositioningVerdict
  paid_behavior: "confirm" | "optimize" | "redirect"
  seniority: SeniorityLevel
}

// ── Lens projections (project-twice) ─────────────────────────────────────────
//
// PROPOSAL (minimal). Discriminated union on `lens`.
//   free  — the verdict + perception, surfaced read-only. NO fix: no coaching,
//           no positioning/cover-letter/networking strategy. why/risk are
//           diagnosis only.
//   paid  — one integrated coaching render: the two verdicts fused into a single
//           action object plus paid_behavior. why/risk plus the through-line.
export type LensProjection =
  | {
      lens: "free"
      decision: Decision
      score: number
      perception: string // from PositioningVerdict.perception
      in_the_way: boolean // positioning blocking the fit?
      why: string[] // read-only diagnosis
      risk: string[] // read-only diagnosis
    }
  | {
      lens: "paid"
      decision: Decision
      score: number
      perception: string
      paid_behavior: "confirm" | "optimize" | "redirect"
      // one integrated coaching render — fit + positioning → action
      coaching: {
        lead_with: string // the single strongest through-line
        reframe: string // how to retell the story for this role
        close_the_gap: string | null // the one fix, or null on "confirm"
      }
      why: string[]
      risk: string[]
    }
