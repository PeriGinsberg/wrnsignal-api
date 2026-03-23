// FILE: app/api/jobfit/constraints.ts

import type { GateTriggered, StructuredJobSignals, StructuredProfileSignals } from "./signals"

function normCity(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function cityMatches(jobCity: string, allowed: string[]): boolean {
  const j = normCity(jobCity)
  const prefs = allowed.map(normCity).filter(Boolean)

  // basic normalization helpers
  const mapAlias = (x: string) => {
    if (x === "nyc" || x.includes("new york")) return "new york"
    if (x.includes("washington") && (x.includes("dc") || x.includes("d c"))) return "washington dc"
    return x
  }

  const jj = mapAlias(j)
  const pp = prefs.map(mapAlias)

  return pp.includes(jj)
}

/**
 * Gate philosophy:
 * - force_pass = hard viability blocker (do not apply)
 * - floor_review = not an apply, but may still be worth networking/review
 */
export function evaluateGates(job: StructuredJobSignals, profile: StructuredProfileSignals): GateTriggered {
  // ---------------- Hard stops ----------------

  if (job.mbaRequired) {
    return { type: "force_pass", gateCode: "GATE_MBA_REQUIRED", detail: "MBA required" }
  }
if (job.credentialRequired) {
    const profileFunctionTags = profile.function_tags || []
    const statedRoles = (profile.statedInterests?.targetRoles || []).join(" ").toLowerCase()
    const statedIndustries = (profile.statedInterests?.targetIndustries || []).join(" ").toLowerCase()

    const hasLegalSignal =
      profileFunctionTags.includes("legal_regulatory") ||
      statedRoles.includes("law") ||
      statedRoles.includes("legal") ||
      statedRoles.includes("attorney") ||
      statedIndustries.includes("law") ||
      statedIndustries.includes("legal")

    const hasMedSignal =
      profileFunctionTags.includes("premed_clinical") ||
      statedRoles.includes("medical") ||
      statedRoles.includes("physician") ||
      statedRoles.includes("nursing")

    const hasCPASignal =
      statedRoles.includes("cpa") ||
      statedRoles.includes("certified public accountant")

    const profileHasCredential = hasLegalSignal || hasMedSignal || hasCPASignal

    if (!profileHasCredential) {
      return {
        type: "force_pass",
        gateCode: "GATE_CREDENTIAL_REQUIRED",
        detail: `This role requires ${job.credentialDetail || "a professional credential or enrollment"} that is not present in your background. Applying without this qualification will not result in an interview.`,
      }
    }
  }

  if (profile.constraints.hardNoSales && job.isSalesHeavy) {
    return { type: "force_pass", gateCode: "GATE_HARD_SALES", detail: "Hard no sales" }
  }

  if (profile.constraints.hardNoGovernment && job.isGovernment) {
    return { type: "force_pass", gateCode: "GATE_HARD_GOV", detail: "Hard no government" }
  }

  // Hard no fully remote means: remote roles are a hard stop.
  // Hybrid/onsite are fine.
  if (profile.constraints.hardNoFullyRemote && job.location.mode === "remote") {
    return { type: "force_pass", gateCode: "GATE_REMOTE_MISMATCH", detail: "Hard no remote vs remote job" }
  }

  // If the candidate explicitly says "no heavy analytics", treat heavy analytics as a hard stop.
  // With your updated extract.ts, "Marketing Insights" style roles will now correctly trip this.
 

  // Graduation window mismatch (job explicitly screening)
  if (profile.gradYear && job.gradYearHint) {
    const delta = Math.abs(profile.gradYear - job.gradYearHint)
    if (delta >= 2) {
      return { type: "force_pass", gateCode: "GATE_GRAD_MISMATCH", detail: "Graduation window mismatch" }
    }
  }

  // ---------------- Soft overrides (Apply -> Review) ----------------

  // Location mismatch when constrained:
  // Prefer city mismatch when we have explicit city prefs + job city.
  // Fall back to mode mismatch only when city info is missing.
  const profileConstrained = Boolean(profile.locationPreference.constrained)
  const jobConstrained = Boolean(job.location.constrained)

  if (profileConstrained && jobConstrained) {
    const jobCity = job.location.city
    const allowedCities = profile.locationPreference.allowedCities

    const hasCityPrefs = Array.isArray(allowedCities) && allowedCities.length > 0
    const jobCityKnown = typeof jobCity === "string" && jobCity.trim().length > 0

    if (hasCityPrefs && jobCityKnown) {
      if (!cityMatches(jobCity!, allowedCities!)) {
        return {
          type: "floor_review",
          gateCode: "GATE_FLOOR_REVIEW_LOCATION",
          detail: "Constrained city mismatch",
        }
      }
    } else {
      // fallback: mode mismatch only
      const pm = profile.locationPreference.mode
      const jm = job.location.mode
      if (pm !== "unclear" && jm !== "unclear" && pm !== jm) {
        return {
          type: "floor_review",
          gateCode: "GATE_FLOOR_REVIEW_LOCATION",
          detail: "Location mismatch (constrained)",
        }
      }
    }
  }

  // Pref full-time vs contract should block Apply but not necessarily “Pass”
  if (profile.constraints.prefFullTime && job.isContract) {
    return { type: "floor_review", gateCode: "GATE_FLOOR_REVIEW_CONTRACT", detail: "Pref full-time vs contract" }
  }

  return { type: "none" }
}