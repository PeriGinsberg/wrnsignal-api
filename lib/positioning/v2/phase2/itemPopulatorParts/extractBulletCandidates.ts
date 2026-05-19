// lib/positioning/v2/phase2/itemPopulatorParts/extractBulletCandidates.ts
//
// Filter why_structured to reframe-flavored entries (action mentions
// retitle / reframe / rewrite / frame this / frame your / rephrase /
// restructure), anchor each entry's lead against resume_text, and emit
// a BulletCandidate per successful anchor.
//
// Both gates must pass: reframe-flavored action AND successful anchor.
// Anchor failures log a telemetry line per design point 2 so Commit 3
// verification can tune the anchoring threshold.
//
// Pure function (except for one telemetry console.log). No DB / LLM / I/O.

import type {
  JobfitResultJson,
  WhyStructuredItem,
} from "@/lib/positioning/v2/types"
import type { BulletCandidate } from "./types"
import { anchorLeadToResume } from "./anchorBullet"

/**
 * Action phrases that flag a why_structured.action as instructing the
 * user to reframe an existing resume bullet — as opposed to "mention in
 * cover letter" or "reach out to recruiter" actions, which are valid
 * coach moves but not bullet reframes.
 *
 * Match is case-insensitive substring. First match wins and is recorded
 * in BulletCandidate.action_match for downstream telemetry / debugging.
 *
 * Ordering matters only for action_match telemetry — the more specific
 * phrases ("frame this", "frame your") would otherwise lose to the
 * single-word phrases if both appeared. None of the current phrases
 * overlap, but listed in the order Peri locked.
 */
const REFRAME_FLAVORED_PHRASES: ReadonlyArray<string> = [
  "retitle",
  "reframe",
  "rewrite",
  "frame this",
  "frame your",
  "rephrase",
  "restructure",
]

/**
 * First reframe phrase that occurs in `action` (case-insensitive), or
 * null. Iterates REFRAME_FLAVORED_PHRASES in declaration order.
 */
function findReframePhrase(action: string): string | null {
  const lower = action.toLowerCase()
  for (const phrase of REFRAME_FLAVORED_PHRASES) {
    if (lower.includes(phrase)) return phrase
  }
  return null
}

/**
 * Build BulletCandidate[] from jobfit.why_structured + resumeText.
 *
 * Algorithm per why_structured entry:
 *   1. Must have non-empty lead, connection, action, keyword strings
 *   2. action must contain a reframe-flavored phrase (case-insensitive)
 *   3. lead must anchor to a resume line (≥ ANCHOR_MIN_OVERLAP unique
 *      content-word overlap; see anchorBullet.ts)
 *
 * All three gates must pass. Anchor failures log:
 *   [itemPopulator] anchor-failed lead="<first 60 chars>" action_match="<phrase>"
 *
 * Defensive:
 *   - null/undefined jobfit → []
 *   - non-array why_structured → []
 *   - null/empty resumeText → []
 *   - malformed entry (missing field, wrong-type field) → skipped silently
 */
export function extractBulletCandidates(
  jobfit: JobfitResultJson | null | undefined,
  resumeText: string | null | undefined,
): BulletCandidate[] {
  if (!jobfit || typeof jobfit !== "object") return []
  if (!Array.isArray(jobfit.why_structured)) return []
  if (!resumeText || typeof resumeText !== "string") return []
  if (resumeText.trim().length === 0) return []

  const out: BulletCandidate[] = []
  for (const raw of jobfit.why_structured) {
    if (!raw || typeof raw !== "object") continue
    const item = raw as Partial<WhyStructuredItem>

    const lead = typeof item.lead === "string" ? item.lead.trim() : ""
    const connection =
      typeof item.connection === "string" ? item.connection.trim() : ""
    const action = typeof item.action === "string" ? item.action : ""
    const keyword = typeof item.keyword === "string" ? item.keyword.trim() : ""

    if (!lead || !connection || !action || !keyword) continue

    const actionMatch = findReframePhrase(action)
    if (actionMatch === null) continue

    const anchored = anchorLeadToResume(lead, resumeText)
    if (anchored === null) {
      const leadSnippet = lead.slice(0, 60)
      console.log(
        `[itemPopulator] anchor-failed lead="${leadSnippet}" action_match="${actionMatch}"`,
      )
      continue
    }

    out.push({
      original_bullet: anchored,
      jd_context: connection,
      keyword,
      action_match: actionMatch,
    })
  }
  return out
}
