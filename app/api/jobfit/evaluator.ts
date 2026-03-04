// app/api/jobfit/evaluator.ts
//
// Fix: adapter -> evaluator signal flow for tools (and other structured signals)
// Problem observed:
// - The deterministic evaluator extracts required tools from the JOB text,
//   then checks whether the PROFILE text mentions them.
// - If the profile text is generated from a structured profile blob and does not include tool tokens,
//   "missing tool" detection collapses (and decisions can collapse to Pass/Review incorrectly).
//
// Approach:
// - Keep the current engine (runJobFit) unchanged.
// - Augment profileText deterministically using the structured overrides produced by mapClientProfileToOverrides.
// - This makes tool tokens visible to downstream regex/heuristics without changing scoring code.

import { mapClientProfileToOverrides } from "../_lib/jobfitProfileAdapter"
import { runJobFit } from "../_lib/jobfitEvaluator"

type AnyObj = Record<string, any>

function norm(x: any): string {
  return String(x ?? "").trim()
}

function uniqStrings(xs: string[]): string[] {
  const out: string[] = []
  for (const x of xs.map((v) => norm(v)).filter(Boolean)) if (!out.includes(x)) out.push(x)
  return out
}

function appendSignalBlock(profileText: string, lines: string[]): string {
  const cleanLines = lines.map((s) => (s || "").trim()).filter(Boolean)
  if (!cleanLines.length) return profileText

  // Always append (never replace) to preserve raw resume content and existing extraction behavior.
  const block =
    "\n\n" +
    "----- PROFILE SIGNAL OVERRIDES (DETERMINISTIC) -----\n" +
    cleanLines.join("\n") +
    "\n----- END PROFILE SIGNAL OVERRIDES -----\n"

  // Avoid double-appending in case upstream mistakenly calls twice.
  if (profileText.includes("PROFILE SIGNAL OVERRIDES (DETERMINISTIC)")) return profileText

  return (profileText || "").trim() + block
}

function buildAugmentedProfileText(args: {
  profileText: string
  profileStructured?: AnyObj | null
  targetRoles?: string | null
  preferredLocations?: string | null
}): { augmentedProfileText: string; overrides: AnyObj } {
  const { profileText, profileStructured, targetRoles, preferredLocations } = args

  const overrides = mapClientProfileToOverrides({
    profileText: profileText || "",
    profileStructured: (profileStructured || null) as AnyObj | null,
    targetRoles: targetRoles ?? null,
    preferredLocations: preferredLocations ?? null,
  }) as AnyObj

  const lines: string[] = []

  // Tools are the top priority: the evaluator checks profile text for these tokens.
  const tools = Array.isArray(overrides?.tools) ? uniqStrings(overrides.tools) : []
  if (tools.length) {
    // Use lower-case tokens (adapter already canonicalizes), but keep as-is to avoid surprises.
    lines.push(`TOOLS: ${tools.join(", ")}`)
  }

  // Families / targets: helpful for other deterministic checks (now and future)
  const targetFamilies = Array.isArray(overrides?.targetFamilies) ? uniqStrings(overrides.targetFamilies) : []
  if (targetFamilies.length) lines.push(`TARGET_FAMILIES: ${targetFamilies.join(", ")}`)

  // Constraints: emit only true booleans so we don't spam tokens.
  const c = overrides?.constraints && typeof overrides.constraints === "object" ? overrides.constraints : null
  if (c) {
    const keys = Object.keys(c).filter((k) => c[k] === true)
    if (keys.length) lines.push(`CONSTRAINTS_TRUE: ${keys.join(", ")}`)
  }

  // Location preference: keep simple so evaluator regex doesn't get confused.
  const lp = overrides?.locationPreference && typeof overrides.locationPreference === "object" ? overrides.locationPreference : null
  if (lp) {
    const mode = norm(lp.mode) || "unclear"
    const constrained = lp.constrained === true ? "true" : lp.constrained === false ? "false" : "unknown"
    const allowedCities = Array.isArray(lp.allowedCities) ? uniqStrings(lp.allowedCities) : []
    const cityStr = allowedCities.length ? `; allowedCities=${allowedCities.join(", ")}` : ""
    lines.push(`LOCATION_PREFERENCE: mode=${mode}; constrained=${constrained}${cityStr}`)
  }

  const gradYear = Number.isFinite(Number(overrides?.gradYear)) ? Number(overrides.gradYear) : null
  if (gradYear) lines.push(`GRAD_YEAR: ${gradYear}`)

  const yearsExp = Number.isFinite(Number(overrides?.yearsExperienceApprox)) ? Number(overrides.yearsExperienceApprox) : null
  if (yearsExp !== null) lines.push(`YEARS_EXPERIENCE_APPROX: ${yearsExp}`)

  const augmentedProfileText = appendSignalBlock(profileText || "", lines)

  return { augmentedProfileText, overrides }
}

/**
 * Public entry used by the route handler.
 * Keep signature compatible with your current route as much as possible.
 */
export async function evaluateJobFit(args: {
  jobText: string
  profileText: string
  profileStructured?: AnyObj | null
  targetRoles?: string | null
  preferredLocations?: string | null
}) {
  const { augmentedProfileText, overrides } = buildAugmentedProfileText({
    profileText: args.profileText,
    profileStructured: args.profileStructured ?? null,
    targetRoles: args.targetRoles ?? null,
    preferredLocations: args.preferredLocations ?? null,
  })

  // runJobFit is the deterministic engine; it primarily reads profileText + jobText.
  const result = await runJobFit({
    jobText: args.jobText || "",
    profileText: augmentedProfileText || "",
    profileStructured: overrides, // keep passing overrides for future use (engine currently "void"s it in some versions)
  })

  return result
}
