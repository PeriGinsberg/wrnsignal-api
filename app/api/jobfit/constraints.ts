// FILE: app/api/jobfit/constraints.ts

import type { GateTriggered, StructuredJobSignals, StructuredProfileSignals } from "./signals"

export function evaluateGates(job: StructuredJobSignals, profile: StructuredProfileSignals): GateTriggered {
  if (job.mbaRequired) {
    return { type: "force_pass", gateCode: "GATE_MBA_REQUIRED", detail: "MBA required" }
  }

  if (profile.constraints.hardNoSales && job.isSalesHeavy) {
    return { type: "force_pass", gateCode: "GATE_HARD_SALES", detail: "Hard no sales" }
  }

  if (profile.constraints.hardNoGovernment && job.isGovernment) {
    return { type: "force_pass", gateCode: "GATE_HARD_GOV", detail: "Hard no government" }
  }

  if (profile.constraints.preferNotAnalyticsHeavy && job.analytics.isHeavy) {
    return { type: "force_pass", gateCode: "GATE_HEAVY_ANALYTICS", detail: "Heavy analytics mismatch" }
  }

  if (profile.gradYear && job.gradYearHint) {
    const delta = Math.abs(profile.gradYear - job.gradYearHint)
    if (delta >= 2) {
      return { type: "force_pass", gateCode: "GATE_GRAD_MISMATCH", detail: "Graduation window mismatch" }
    }
  }

  const jobConstrained = job.location.constrained
  const profileConstrained = profile.locationPreference.constrained

  const modeMismatch =
    jobConstrained &&
    profileConstrained &&
    profile.locationPreference.mode !== "unclear" &&
    job.location.mode !== "unclear" &&
    profile.locationPreference.mode !== job.location.mode

  if (modeMismatch) {
    return { type: "floor_review", gateCode: "GATE_FLOOR_REVIEW_LOCATION", detail: "Location mismatch (constrained)" }
  }

  if (profile.constraints.prefFullTime && job.isContract) {
    return { type: "floor_review", gateCode: "GATE_FLOOR_REVIEW_CONTRACT", detail: "Pref full-time vs contract" }
  }

  return { type: "none" }
}