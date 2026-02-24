// jobfit/constraints.ts

import { Gate } from "./policy"
import { StructuredJobSignals, StructuredProfileSignals } from "./signals"

export function evaluateGates(job: StructuredJobSignals, profile: StructuredProfileSignals): Gate {
  // Force Pass gates (hard stop)
  if (job.mbaRequired) {
    return { type: "force_pass", reason: "MBA required", gateCode: "GATE_MBA_REQUIRED" }
  }

  if (profile.constraints.hardNoSales && job.isSalesHeavy) {
    return { type: "force_pass", reason: "Hard no sales", gateCode: "GATE_HARD_SALES" }
  }

  if (profile.constraints.hardNoGovernment && job.isGovernment) {
    return { type: "force_pass", reason: "Hard no government", gateCode: "GATE_HARD_GOV" }
  }

  if (profile.constraints.preferNotAnalyticsHeavy && job.analytics.isHeavy) {
    return { type: "force_pass", reason: "Heavy analytics mismatch", gateCode: "GATE_HEAVY_ANALYTICS" }
  }

  if (profile.gradYear && job.gradYearHint) {
    // If job explicitly screens for a different graduation year, treat as force pass.
    // Example: job says Class of 2024/2025, profile is 2027.
    const delta = Math.abs(profile.gradYear - job.gradYearHint)
    if (delta >= 2) {
      return { type: "force_pass", reason: "Graduation window mismatch", gateCode: "GATE_GRAD_MISMATCH" }
    }
  }

  // Floor Review gates (soft override)
  // Location mismatch when constrained is not a force pass because you may still want to network anyway, but it should not be Apply.
  const jobConstrained = job.location.constrained
  const profileConstrained = profile.locationPreference.constrained

  const locationMismatch =
    jobConstrained &&
    profileConstrained &&
    profile.locationPreference.mode !== "unclear" &&
    job.location.mode !== "unclear" &&
    profile.locationPreference.mode !== job.location.mode

  if (locationMismatch) {
    return { type: "floor_review", reason: "Location mismatch (constrained)", gateCode: "GATE_FLOOR_REVIEW_LOCATION" }
  }

  if (profile.constraints.prefFullTime && job.isContract) {
    return { type: "floor_review", reason: "Pref full-time vs contract", gateCode: "GATE_FLOOR_REVIEW_CONTRACT" }
  }

  return { type: "none" }
}