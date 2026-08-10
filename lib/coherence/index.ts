// lib/coherence/index.ts
//
// MOVED 2026-08-10 from lib/positioning/v2/coherence/. It never belonged to
// Positioning v2 — that work was abandoned (see
// docs/positioning-v2-abandoned.md) and this is the one piece of it that was
// live. app/api/jobfit-run-trial-open/route.ts calls scoreCoherence on the
// FREE SCAN path, in production, today.
//
// It was moved rather than left behind precisely so nobody deleting the
// abandoned tree takes the free scan down with it.
//
// Resume-coherence detector — public entry point.
//
// scoreCoherence(resumeText) runs the validated pipeline end-to-end:
//   normalize → isolate → scope to professional experience → segment into
//   role-blocks → classify each block to a lane (1 Haiku call) → bullet-weighted
//   Herfindahl concentration → LOCKED fire-gate.
//
// FAILS OPEN: any error, missing API key, empty segmentation, or unscorable
// metric returns null. Callers treat null as "no coherence read" and must never
// let it affect the rest of the response.
//
// Scores ONLY the resume text passed in (the resume submitted with the run) —
// no persona, no system default.

import {
  normalizeStructure,
  isolateResumeBody,
  extractProfessionalExperienceText,
  segmentBlocks,
} from "./resumeSegmentation"
import { classifyBlocks } from "./laneClassifier"
import { concentration, coherenceFires } from "./concentration"

export interface CoherenceResult {
  /** true ⇒ the resume scatters across lanes (surface the read). */
  fires: boolean
  label: "scattered" | "focused"
  /** Herfindahl concentration index (0–1; higher = more focused). */
  h_index: number
  top_lane: string | null
  top_lane_share: number
  /** lane → share of bullet-weighted experience. */
  lane_distribution: Record<string, number>
  block_count: number
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

export async function scoreCoherence(resumeText: string): Promise<CoherenceResult | null> {
  try {
    if (!resumeText || resumeText.trim().length < 100) return null

    const professional = extractProfessionalExperienceText(
      isolateResumeBody(normalizeStructure(resumeText)),
    )
    const blocks = segmentBlocks(professional)
    if (blocks.length === 0) return null

    const laneByIndex = await classifyBlocks(blocks)
    const metric = concentration(blocks, laneByIndex)
    if (metric.H == null) return null // unscorable (no classified blocks)

    const fires = coherenceFires(metric)
    const dist: Record<string, number> = {}
    for (const [lane, s] of Object.entries(metric.lane_distribution)) dist[lane] = round3(s)

    return {
      fires,
      label: fires ? "scattered" : "focused",
      h_index: round3(metric.H),
      top_lane: metric.top_lane,
      top_lane_share: round3(metric.top_lane_share),
      lane_distribution: dist,
      block_count: blocks.length,
    }
  } catch (err) {
    console.error("[coherence] scoreCoherence failed:", (err as Error)?.message || String(err))
    return null
  }
}
