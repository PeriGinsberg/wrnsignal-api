// scripts/migrate-candidate-targeting/inference-prompt.ts
//
// Prompt + schema for Claude Haiku to map a candidate's targeting into the
// lane taxonomy during Stage 1d migration backfill.
//
// FRD: docs/Features/positioning-foundation-frd.md (section 4.6)
// Runlog: docs/Features/foundation-migration-runlog.md
// Taxonomy: lib/laneTaxonomy.ts
//
// Used only when the deterministic forward map (getLaneFromJobFamily) is
// inconclusive — e.g., JobFamily is null/Analytics/Trades, or the candidate
// has no successful JobFit run yet. The script's deterministic path handles
// the clean cases (DD-02, DD-04); this LLM call handles the ambiguous tail.
//
// Strict JSON contract: the LLM MUST return parseable JSON matching the
// InferenceOutput shape. Lane and sublane IDs MUST be from the taxonomy.
// Confidence MUST be one of high|medium|low.

import { LANES } from "@/lib/laneTaxonomy"

// ============================================================================
// Types
// ============================================================================

export type InferenceInput = {
  /** Free-text target_roles from intake. May be empty. */
  targetRoles: string
  /** current_status from intake ('Current student', 'Working professional',
   *  etc.). Used as a soft signal for the LLM. Empty if not set. */
  currentStatus: string
  /** JobFamily detected by JobFit on the candidate's most recent successful
   *  run. May be null if no successful run exists. The script only invokes
   *  the LLM when this is null or in {Analytics, Trades} (per DD-02/DD-03);
   *  for clean families the deterministic forward map handles it. */
  jobFamily: string | null
  /** Resume snippet (first ~500 chars of resume_text) for context. Optional
   *  but helpful when target_roles is sparse. Empty string acceptable. */
  resumeSnippet: string
}

export type InferenceOutput = {
  /** One of the 12 lane IDs from lib/laneTaxonomy.ts LANES. */
  lane: string
  /** One of the sub-lane IDs valid for `lane`. null when lane='other'. */
  sublane: string | null
  /** 5-15 word description when lane='other', else null. */
  primary_other_description: string | null
  /** LLM's self-rated confidence. Migration script writes the row regardless
   *  but uses this to flag low-confidence rows for user-verification UI. */
  confidence: "high" | "medium" | "low"
  /** One-sentence reasoning. Logged for debugging; NOT written to DB. */
  reasoning: string
}

// ============================================================================
// System prompt (taxonomy embedded at module load)
// ============================================================================

function renderTaxonomyForPrompt(): string {
  const lines: string[] = []
  for (const lane of LANES) {
    if (lane.id === "other") {
      lines.push(`- ${lane.id} (${lane.label}) — free-text description; no sub-lanes`)
      continue
    }
    lines.push(`- ${lane.id} (${lane.label})`)
    for (const sub of lane.subLanes) {
      lines.push(`    - ${sub.id} (${sub.label})`)
    }
  }
  return lines.join("\n")
}

export const SYSTEM_PROMPT = `You classify a job candidate's target career direction into one of 12 lanes. Each lane has sub-lanes; you pick one of each. Your output drives a personalized resume tailoring workflow, so accuracy matters — but the candidate will verify your choice, so confident judgment under ambiguity is better than refusing to classify.

Rules:
- Choose the BEST single lane. If multiple plausibly fit, pick the strongest signal.
- For non-Other lanes, you MUST choose a sub-lane that belongs to the chosen lane.
- Use 'other' ONLY when no provided lane is a meaningful fit. Do NOT use 'other' as a soft default when the signal is just sparse — pick the closest lane and lower your confidence instead.
  Example: target_roles="business roles" with no JobFamily is ambiguous, but operations_strategy / business_operations is the most likely fit — choose that with confidence="low" rather than "other".
  Before choosing 'other', ask: which real lane is this candidate's actual target closest to, even if the fit is imperfect? If you can name one, that's your answer with appropriate confidence.
  Use 'other' when the input genuinely spans multiple lanes equally (no single lane dominates) and force-fitting to one would ignore meaningful parts of the input. Example: target_roles="research and entrepreneurship" spans academia, founder/business, and possibly technology — no single lane dominates → lane='other', primary_other_description='Research-to-entrepreneurship transition (academic + startup founder)', confidence='medium'.
- For 'other', provide a 5-15 word description in primary_other_description; leave it null for any other lane.
- Confidence scale:
  * "high"   — lane is unambiguous AND the chosen sub-lane is a reasonable fit (sub-lane needn't be the only possibility)
  * "medium" — lane is unambiguous but the sub-lane is genuinely uncertain across multiple plausible choices
  * "low"    — the lane itself is ambiguous, OR the input is so sparse/vague that any classification is a guess
  Hedging language in target_roles ('if better fit', 'possibly', 'also considering', 'open to', 'exploring') indicates candidate uncertainty about lane direction. Even if a primary lane is namable, hedged inputs are at most medium confidence. Multi-hedged inputs ('A, B if better, possibly C') are low confidence regardless of which lane you pick.
- Reasoning: one sentence explaining your choice. Helps us debug; not stored.

Engineering note: JobFamily.Engineering maps to the Technology lane ONLY for software-adjacent work (software, ML engineering, data engineering, infrastructure). Mechanical / Civil / Biomedical / Industrial / Chemical engineering candidates do NOT belong in Technology — route them to 'other' with a description naming the discipline.
  Example: target_roles="Mechanical engineer" with JobFamily=Engineering → lane="other", primary_other_description="Mechanical engineer (non-software)", confidence="high".

Return JSON only, no markdown fences, matching this exact schema:
{
  "lane": "<one of the lane IDs below>",
  "sublane": "<one of the sub-lane IDs valid for that lane, or null when lane='other'>",
  "primary_other_description": "<5-15 words, ONLY when lane='other', else null>",
  "confidence": "high" | "medium" | "low",
  "reasoning": "<one sentence>"
}

TAXONOMY (lane_id and sub_lane_id values are literal — use exactly these strings):

${renderTaxonomyForPrompt()}
`

// ============================================================================
// User prompt builder
// ============================================================================

export function buildUserPrompt(input: InferenceInput): string {
  const parts: string[] = []
  parts.push("Candidate targeting to classify:")
  parts.push("")
  parts.push(`target_roles: ${input.targetRoles.trim() || "(empty)"}`)
  parts.push(`current_status: ${input.currentStatus.trim() || "(empty)"}`)
  parts.push(`job_family_detected: ${input.jobFamily ?? "(none)"}`)
  if (input.resumeSnippet.trim()) {
    parts.push("")
    parts.push("resume_snippet (first ~500 chars for context):")
    parts.push("```")
    parts.push(input.resumeSnippet.trim().slice(0, 500))
    parts.push("```")
  }
  parts.push("")
  parts.push("Return JSON only.")
  return parts.join("\n")
}

// ============================================================================
// Strict JSON parser (the LLM may return imperfect JSON; be tolerant)
// ============================================================================

/**
 * Parse the LLM's response. Strips markdown fences if present, validates
 * the shape against InferenceOutput. Returns null + error string on failure
 * (caller decides whether to retry or flag for manual review).
 */
export function parseInferenceOutput(
  raw: string,
): { ok: true; output: InferenceOutput } | { ok: false; error: string } {
  let text = raw.trim()
  // Strip ```json ... ``` fences if present
  const fence = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  if (fence) text = fence[1].trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return {
      ok: false,
      error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Response is not a JSON object" }
  }
  const p = parsed as Record<string, unknown>

  if (typeof p.lane !== "string" || !p.lane) {
    return { ok: false, error: "missing or non-string lane" }
  }
  if (p.sublane !== null && typeof p.sublane !== "string") {
    return { ok: false, error: "sublane must be string or null" }
  }
  if (
    p.primary_other_description !== null &&
    typeof p.primary_other_description !== "string"
  ) {
    return {
      ok: false,
      error: "primary_other_description must be string or null",
    }
  }
  if (
    p.confidence !== "high" &&
    p.confidence !== "medium" &&
    p.confidence !== "low"
  ) {
    return {
      ok: false,
      error: `confidence must be high|medium|low, got ${String(p.confidence)}`,
    }
  }
  if (typeof p.reasoning !== "string") {
    return { ok: false, error: "missing or non-string reasoning" }
  }

  return {
    ok: true,
    output: {
      lane: p.lane,
      sublane: p.sublane as string | null,
      primary_other_description: p.primary_other_description as string | null,
      confidence: p.confidence,
      reasoning: p.reasoning,
    },
  }
}
