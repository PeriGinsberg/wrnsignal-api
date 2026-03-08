// src/score.ts
import { Decision } from "./types"

const BANDS: Record<Decision, { min: number; max: number }> = {
  PRIORITY_APPLY: { min: 90, max: 100 },
  APPLY: { min: 75, max: 89 },
  REVIEW: { min: 50, max: 74 },
  PASS: { min: 0, max: 49 },
}

/**
 * v1 deterministic scoring:
 * - Produces a simple integer in the correct band.
 * - Decision is authoritative; score is secondary.
 *
 * We intentionally keep scoring simple for v1 to avoid drift.
 */
export function computeScore(decision: Decision, t2Count: number): number {
  const band = BANDS[decision]

  // Base within-band target by decision
  let raw = Math.round((band.min + band.max) / 2)

  // Deterministic adjustments: more Tier 2 risks reduce score (within the band)
  raw -= t2Count * 3

  return clamp(raw, band.min, band.max)
}

export function clampScoreToBand(decision: Decision, score: number): number {
  const band = BANDS[decision]
  return clamp(score, band.min, band.max)
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min
  if (n > max) return max
  return n
}