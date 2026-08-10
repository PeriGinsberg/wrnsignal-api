// lib/coherence/concentration.ts
//
// Resume-coherence detector — concentration metric + LOCKED fire-gate.
//
// Ported from the validated scaffolding (tests/concentration/resumeConcentration.mjs).
// The fire-gate below is the LOCKED, human-approved configuration:
//   fire "scattered"  ⇔  H < 0.42  AND  ≥2 lanes each ≥ 0.20  AND  top_lane_share < 0.50
// The dominance cap (top < 0.50) is the core rule: never fire when one lane
// holds half-or-more of the bullet-weighted experience.

import type { Block } from "./resumeSegmentation"
import type { LaneByIndex } from "./laneClassifier"

export interface CoherenceMetric {
  /** Herfindahl index over the bullet-weighted lane distribution; null if unscorable. */
  H: number | null
  top_lane: string | null
  top_lane_share: number
  lane_distribution: Record<string, number>
  /** number of blocks that received a lane (i.e. contributed weight). */
  classified: number
}

// ── LOCKED gate constants ───────────────────────────────────────────────────
export const H_THRESHOLD = 0.42
export const MIN_SHARE = 0.2
export const TOP_CAP = 0.5

/** Bullet-weighted lane concentration. Blocks weigh by bullet count (≥1). */
export function concentration(blocks: Block[], laneByIndex: LaneByIndex): CoherenceMetric {
  const laneWeight: Record<string, number> = {}
  let total = 0
  let classified = 0
  blocks.forEach((b, i) => {
    const lane = laneByIndex[i]
    if (!lane || lane === "unknown") return
    const w = b.bullets.length || 1
    laneWeight[lane] = (laneWeight[lane] || 0) + w
    total += w
    classified++
  })
  if (total === 0) {
    return { H: null, top_lane: null, top_lane_share: 0, lane_distribution: {}, classified }
  }
  const dist: Record<string, number> = {}
  for (const [lane, w] of Object.entries(laneWeight)) dist[lane] = w / total
  let H = 0
  for (const s of Object.values(dist)) H += s * s
  let top_lane: string | null = null
  let top_lane_share = 0
  for (const [lane, s] of Object.entries(dist)) {
    if (s > top_lane_share) {
      top_lane = lane
      top_lane_share = s
    }
  }
  return { H, top_lane, top_lane_share, lane_distribution: dist, classified }
}

/** The LOCKED fire-gate. True ⇒ surface the coherence ("scattered") read. */
export function coherenceFires(m: CoherenceMetric): boolean {
  if (m.H == null) return false
  const substantialLanes = Object.values(m.lane_distribution).filter(
    (s) => s >= MIN_SHARE,
  ).length
  return m.H < H_THRESHOLD && substantialLanes >= 2 && m.top_lane_share < TOP_CAP
}
