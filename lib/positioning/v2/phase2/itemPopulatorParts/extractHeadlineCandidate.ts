// lib/positioning/v2/phase2/itemPopulatorParts/extractHeadlineCandidate.ts
//
// Derive a headline candidate from jobfit.job_signals.jobTitle (required) +
// .jobFamily (optional) + top-3 why_structured keywords (optional, by
// array order). Returns null when jobTitle is missing — the headline
// reframe item has no anchor without it.
//
// Pure function — no I/O. Draft generation happens later in aiClient
// (Commit 2 will wire this to the orchestrator).
//
// Defensive style matches caseSpecific.ts: param accepts null/undefined,
// every nested-object access guarded by `typeof x === "object"`, every
// string field guarded by `typeof x === "string"` + trim + non-empty
// check.

import type {
  JobfitResultJson,
  WhyStructuredItem,
} from "@/lib/positioning/v2/types"
import type { HeadlineCandidate } from "./types"

/** Trimmed, non-empty job_signals.jobTitle, or null. */
function extractJobTitle(jobfit: JobfitResultJson | null | undefined): string | null {
  if (!jobfit || typeof jobfit !== "object") return null
  const js = (jobfit as { job_signals?: unknown }).job_signals
  if (!js || typeof js !== "object") return null
  const title = (js as { jobTitle?: unknown }).jobTitle
  if (typeof title !== "string") return null
  const trimmed = title.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Trimmed, non-empty job_signals.jobFamily, or null. */
function extractJobFamily(jobfit: JobfitResultJson | null | undefined): string | null {
  if (!jobfit || typeof jobfit !== "object") return null
  const js = (jobfit as { job_signals?: unknown }).job_signals
  if (!js || typeof js !== "object") return null
  const family = (js as { jobFamily?: unknown }).jobFamily
  if (typeof family !== "string") return null
  const trimmed = family.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Top-3 why_structured.keyword strings by array order. why_structured is
 * already weight-descending out of JobFit, so array order = priority order
 * (matches the convention in caseSpecific.ts extractWhyKeywords).
 *
 * Defensive: missing / non-array / malformed entries → drops gracefully.
 * Empty/blank keywords skipped. Stops after 3 valid entries.
 */
function extractTopWhyKeywords(jobfit: JobfitResultJson | null | undefined): string[] {
  if (!jobfit || typeof jobfit !== "object") return []
  if (!Array.isArray(jobfit.why_structured)) return []
  const out: string[] = []
  for (const raw of jobfit.why_structured) {
    if (!raw || typeof raw !== "object") continue
    const item = raw as Partial<WhyStructuredItem>
    if (typeof item.keyword !== "string") continue
    const trimmed = item.keyword.trim()
    if (trimmed.length === 0) continue
    out.push(trimmed)
    if (out.length >= 3) break
  }
  return out
}

/**
 * Build a HeadlineCandidate from jobfit. Returns null when jobTitle is
 * absent — without a target title there's nothing to reframe toward.
 *
 * Note: when jobTitle is present but jobFamily / why_structured are missing
 * or malformed, the candidate is still emitted with jobFamily=null and/or
 * topWhyKeywords=[]. Downstream draft generation handles those gracefully.
 *
 * Defensive cases:
 *   - jobfit null/undefined → null
 *   - jobfit not an object → null
 *   - job_signals missing/wrong-type → null (no jobTitle anchor)
 *   - jobTitle missing/wrong-type/blank-only → null
 *   - jobFamily missing/wrong-type → candidate with jobFamily=null
 *   - why_structured missing/wrong-type → candidate with topWhyKeywords=[]
 */
export function extractHeadlineCandidate(
  jobfit: JobfitResultJson | null | undefined,
): HeadlineCandidate | null {
  const jobTitle = extractJobTitle(jobfit)
  if (jobTitle === null) return null

  return {
    jobTitle,
    jobFamily: extractJobFamily(jobfit),
    topWhyKeywords: extractTopWhyKeywords(jobfit),
  }
}
