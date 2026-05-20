// lib/positioning/v2/phase2/itemPopulatorParts/extractGapCandidates.ts
//
// Filter jobfit.job_signals.requirement_units to core requirements not
// already represented in the resume. "Represented" means EITHER:
//   (a) requirement.key (e.g. "financial_analysis") appears as a
//       case-insensitive substring in resume_text — keys are
//       machine-flavored short IDs so raw substring is sufficient
//   (b) ≥1 content-word from requirement.label overlaps with tokenized
//       resume_text — labels are human-readable phrases so token-level
//       overlap is the right granularity
//
// Either match path counts as represented → skip the candidate.
// Tokenization + STOPWORDS reused from anchorBullet.ts to keep the
// stopword list single-source.
//
// Note: requirement_units lives on jobfit.job_signals but is NOT in the
// narrow JobfitResultJson.job_signals type in lib/positioning/v2/types.ts
// (that type only declares the Phase 1 fields). We read it via
// duck-typing on the raw object.

import type { JobfitResultJson } from "@/lib/positioning/v2/types"
import type { GapCandidate } from "./types"
import { tokenize } from "./anchorBullet"

/**
 * Minimum shape of one requirement_units entry that this filter reads.
 * All fields `unknown` — defensive guards check each before use.
 */
type RequirementUnitRaw = {
  key?: unknown
  label?: unknown
  snippet?: unknown
  requiredness?: unknown
  /**
   * JobFit EvidenceKind passthrough — read into GapCandidate.kind so the
   * G1 gap_shape classifier (lib/positioning/v2/phase2/itemPopulatorParts/
   * classifyGapShape.ts) can use it as a deterministic signal. Defensively
   * unknown — non-string values default to "" in the emit step.
   */
  kind?: unknown
}

/** Pull jobfit.job_signals.requirement_units, defending at each hop. */
function readRequirementUnits(
  jobfit: JobfitResultJson | null | undefined,
): unknown[] {
  if (!jobfit || typeof jobfit !== "object") return []
  const js = (jobfit as { job_signals?: unknown }).job_signals
  if (!js || typeof js !== "object") return []
  const units = (js as { requirement_units?: unknown }).requirement_units
  return Array.isArray(units) ? units : []
}

/**
 * Returns true if the requirement is represented in the resume by either
 * path. resumeLower + resumeTokens are precomputed by the caller so the
 * full requirement_units loop only tokenizes resume_text once.
 */
function isRepresentedInResume(
  key: string,
  label: string,
  resumeLower: string,
  resumeTokens: ReadonlySet<string>,
): boolean {
  // Path (a): raw key substring (machine-flavored short ID)
  if (key.length > 0) {
    const keyLower = key.toLowerCase()
    if (keyLower.length > 0 && resumeLower.includes(keyLower)) {
      return true
    }
  }
  // Path (b): label content-word overlap (≥1 token shared)
  if (label.length > 0) {
    const labelTokens = tokenize(label)
    for (const t of labelTokens) {
      if (resumeTokens.has(t)) return true
    }
  }
  return false
}

/**
 * Build GapCandidate[] from jobfit.job_signals.requirement_units + resumeText.
 *
 * Algorithm per requirement unit:
 *   1. requiredness must === "core" (drops "supporting" and any other value)
 *   2. key + label + snippet must be non-empty strings
 *   3. requirement must NOT be represented in the resume by either
 *      path (a) key substring or path (b) label token overlap
 *
 * Defensive:
 *   - null/undefined jobfit → []
 *   - missing job_signals → []
 *   - non-array requirement_units → []
 *   - null/undefined/wrong-type resumeText → treated as "" (represented=false
 *     for all). The orchestrator (Commit 2) is responsible for not calling
 *     this with an empty resume in production paths, but the helper itself
 *     defaults safely so a missing resume falls through to "every core
 *     requirement is a gap" rather than throwing.
 *   - malformed unit (wrong-type field) → skipped silently
 */
export function extractGapCandidates(
  jobfit: JobfitResultJson | null | undefined,
  resumeText: string | null | undefined,
): GapCandidate[] {
  const units = readRequirementUnits(jobfit)
  if (units.length === 0) return []

  const safeResume = typeof resumeText === "string" ? resumeText : ""
  const resumeLower = safeResume.toLowerCase()
  const resumeTokens = new Set(tokenize(safeResume))

  const out: GapCandidate[] = []
  for (const raw of units) {
    if (!raw || typeof raw !== "object") continue
    const u = raw as RequirementUnitRaw

    if (u.requiredness !== "core") continue

    const key = typeof u.key === "string" ? u.key.trim() : ""
    const label = typeof u.label === "string" ? u.label.trim() : ""
    const snippet = typeof u.snippet === "string" ? u.snippet.trim() : ""

    if (!key || !label || !snippet) continue

    if (isRepresentedInResume(key, label, resumeLower, resumeTokens)) continue

    // kind: passthrough for the G1 classifier. Empty string when the
    // source unit lacked a kind field (production data always has it; this
    // path covers malformed fixtures only).
    const kind = typeof u.kind === "string" ? u.kind : ""

    out.push({
      gap_description: label,
      jd_context: snippet,
      keyword: key,
      kind,
      // gap_shape: "unknown" is the populator-input default. The
      // itemPopulator orchestrator (G1) overwrites this with the
      // classifier's result before constructing PhaseTwoGapItem.
      gap_shape: "unknown",
    })
  }
  return out
}
