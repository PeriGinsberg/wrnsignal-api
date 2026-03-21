import { mapClientProfileToOverrides } from "../_lib/jobfitProfileAdapter"
import { runJobFit } from "../_lib/jobfitEvaluator"
import { renderBulletsV4 } from "./deterministicBulletRendererV4"

type AnyObj = Record<string, any>

type EvaluateJobFitArgs = {
  jobText: string
  profileText?: string | null
  resumeText?: string | null
  profileStructured?: AnyObj | null
  targetRoles?: string | null
  preferredLocations?: string | null
  targetLocations?: string | null
  timeline?: string | null
  jobType?: string | null
  constraints?: string | null
  extraContext?: string | null
}

function norm(x: unknown): string {
  return String(x ?? "").trim()
}

function uniqStrings(xs: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  for (const raw of xs) {
    const v = norm(raw)
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }

  return out
}

function appendSignalBlock(profileText: string, lines: string[]): string {
  const cleanLines = lines.map((s) => norm(s)).filter(Boolean)
  if (!cleanLines.length) return profileText

  const marker = "PROFILE SIGNAL OVERRIDES (DETERMINISTIC)"
  if ((profileText || "").includes(marker)) return profileText

  const block =
    "\n\n" +
    "----- PROFILE SIGNAL OVERRIDES (DETERMINISTIC) -----\n" +
    cleanLines.join("\n") +
    "\n----- END PROFILE SIGNAL OVERRIDES -----\n"

  return (profileText || "").trim() + block
}

function line(label: string, value: unknown): string {
  const v = norm(value)
  return v ? `${label}: ${v}` : ""
}

function buildCanonicalProfileText(args: EvaluateJobFitArgs): string {
  const resumeText = norm(args.resumeText)
  const fallbackProfileText = norm(args.profileText)

  const cleanBlocks = [
    line("Target roles", args.targetRoles),
    line("Preferred locations", args.preferredLocations || args.targetLocations),
    line("Timeline", args.timeline),
    line("Job type", args.jobType),
    line("Constraints", args.constraints),
    line("Extra context", args.extraContext),
    resumeText ? `Resume:\n${resumeText}` : "",
  ].filter(Boolean)

  if (cleanBlocks.length > 0) {
    return cleanBlocks.join("\n\n").trim()
  }

  return fallbackProfileText
}

function buildAugmentedProfileText(args: EvaluateJobFitArgs): {
  augmentedProfileText: string
  baseProfileText: string
  overrides: AnyObj
} {
  const baseProfileText = buildCanonicalProfileText(args)

  const overrides = mapClientProfileToOverrides({
    profileText: baseProfileText || "",
    profileStructured: (args.profileStructured || null) as AnyObj | null,
    targetRoles: args.targetRoles ?? null,
    preferredLocations:
      (args.preferredLocations ?? args.targetLocations ?? null) as string | null,
  }) as AnyObj

  const lines: string[] = []

  const tools = Array.isArray(overrides?.tools) ? uniqStrings(overrides.tools) : []
  if (tools.length) lines.push(`TOOLS: ${tools.join(", ")}`)

  const targetFamilies = Array.isArray(overrides?.targetFamilies)
    ? uniqStrings(overrides.targetFamilies)
    : []
  if (targetFamilies.length) {
    lines.push(`TARGET_FAMILIES: ${targetFamilies.join(", ")}`)
  }

  const statedInterests =
    overrides?.statedInterests && typeof overrides.statedInterests === "object"
      ? overrides.statedInterests
      : null

  if (statedInterests) {
    const targetRoles = Array.isArray(statedInterests.targetRoles)
      ? uniqStrings(statedInterests.targetRoles)
      : []
    const adjacentRoles = Array.isArray(statedInterests.adjacentRoles)
      ? uniqStrings(statedInterests.adjacentRoles)
      : []
    const targetIndustries = Array.isArray(statedInterests.targetIndustries)
      ? uniqStrings(statedInterests.targetIndustries)
      : []

    if (targetRoles.length) lines.push(`STATED_TARGET_ROLES: ${targetRoles.join(", ")}`)
    if (adjacentRoles.length) lines.push(`STATED_ADJACENT_ROLES: ${adjacentRoles.join(", ")}`)
    if (targetIndustries.length) lines.push(`STATED_TARGET_INDUSTRIES: ${targetIndustries.join(", ")}`)
  }

  const c =
    overrides?.constraints && typeof overrides.constraints === "object"
      ? overrides.constraints
      : null
  if (c) {
    const trueKeys = Object.keys(c).filter((k) => c[k] === true)
    if (trueKeys.length) lines.push(`CONSTRAINTS_TRUE: ${trueKeys.join(", ")}`)
  }

  const lp =
    overrides?.locationPreference &&
    typeof overrides.locationPreference === "object"
      ? overrides.locationPreference
      : null
  if (lp) {
    const mode = norm(lp.mode) || "unclear"
    const constrained =
      lp.constrained === true
        ? "true"
        : lp.constrained === false
          ? "false"
          : "unknown"
    const allowedCities = Array.isArray(lp.allowedCities)
      ? uniqStrings(lp.allowedCities)
      : []
    const cityStr = allowedCities.length
      ? `; allowedCities=${allowedCities.join(", ")}`
      : ""
    lines.push(
      `LOCATION_PREFERENCE: mode=${mode}; constrained=${constrained}${cityStr}`
    )
  }

  const gradYear = Number.isFinite(Number(overrides?.gradYear))
    ? Number(overrides.gradYear)
    : null
  if (gradYear) lines.push(`GRAD_YEAR: ${gradYear}`)

  const yearsExp = Number.isFinite(Number(overrides?.yearsExperienceApprox))
    ? Number(overrides.yearsExperienceApprox)
    : null
  if (yearsExp !== null) lines.push(`YEARS_EXPERIENCE_APPROX: ${yearsExp}`)

  const augmentedProfileText = appendSignalBlock(baseProfileText || "", lines)

  return { augmentedProfileText, baseProfileText, overrides }
}

export async function evaluateJobFit(args: EvaluateJobFitArgs) {
  const { augmentedProfileText, baseProfileText, overrides } =
    buildAugmentedProfileText(args)

  const result = await runJobFit({
    jobText: args.jobText || "",
    profileText: augmentedProfileText || "",
    profileOverrides: overrides,
  })

const rendered = renderBulletsV4(result as any)

return {
  ...result,
  why: rendered.why,
  risk: rendered.risk,
  bullets: rendered.why,
  risk_bullets: rendered.risk,
  debug: {
    ...(result as any)?.debug,
    ...rendered.renderer_debug,
    evaluator_profile_source: {
      used_resume_text: Boolean(norm(args.resumeText)),
      used_profile_structured: Boolean(args.profileStructured),
      used_raw_profile_text_fallback:
        !norm(args.resumeText) && Boolean(norm(args.profileText)),
      base_profile_text_len: baseProfileText.length,
      augmented_profile_text_len: augmentedProfileText.length,
    },
  },
}
      ...(result as any)?.debug,
      ...rendered.renderer_debug,
      evaluator_profile_source: {
        used_resume_text: Boolean(norm(args.resumeText)),
        used_profile_structured: Boolean(args.profileStructured),
        used_raw_profile_text_fallback:
          !norm(args.resumeText) && Boolean(norm(args.profileText)),
        base_profile_text_len: baseProfileText.length,
        augmented_profile_text_len: augmentedProfileText.length,
      },
    },
  }
}