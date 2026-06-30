// FILE: app/api/jobfit/constraints.ts

import type { GateTriggered, StructuredJobSignals, StructuredProfileSignals } from "./signals"
import { hasRequiredDegree } from "./signals"

/**
 * Gate philosophy:
 * - force_pass = hard viability blocker (do not apply)
 * - floor_review = not an apply, but may still be worth networking/review
 */
// Technical/specialized families that require domain-specific education and credentials.
// A marketing/consulting/business profile should not match these.
const HARD_TECHNICAL_FAMILIES = new Set([
  "Engineering",
  "IT_Software",
  "Healthcare",
  "Trades",
])

// Business/generalist families — profiles in these families should not match
// hard technical roles.
// DEAD: defined but never read anywhere in the engine (tech-debt). Not
// extended with LifeSciences since nothing consumes it.
const BUSINESS_FAMILIES = new Set([
  "Consulting",
  "Marketing",
  "Finance",
  "Accounting",
  "Analytics",
  "Sales",
  "Operations",
  "HR",
  "Government",
  "PreMed",
  "Other",
])

export function evaluateGates(job: StructuredJobSignals, profile: StructuredProfileSignals): GateTriggered {
  // ---------------- Hard stops ----------------

  // Field mismatch: technical job vs business profile (or vice versa)
  if (HARD_TECHNICAL_FAMILIES.has(job.jobFamily)) {
    const profileFamilies = profile.targetFamilies || []
    const profileHasTechnicalFamily = profileFamilies.some((f) => HARD_TECHNICAL_FAMILIES.has(f))
    if (!profileHasTechnicalFamily && profileFamilies.length > 0) {
      return {
        type: "force_pass",
        gateCode: "GATE_FIELD_MISMATCH",
        detail: `This is a ${job.jobFamily.replace("_", "/")} role that requires specialized technical training. Your profile targets ${profileFamilies.join(", ")} — this is a fundamental field mismatch.`,
      }
    }
  }

  if (hasRequiredDegree(job.degrees, "mba")) {
    const detail = profile.degreeStatus === "in_progress"
      ? "This role requires an MBA. Based on your profile, you are currently pursuing an undergraduate degree. This is a hard requirement that cannot be overcome through other qualifications."
      : "MBA required"
    return { type: "force_pass", gateCode: "GATE_MBA_REQUIRED", detail }
  }
if (job.credentialRequired) {
    // Training programs explicitly provide licensing as part of onboarding —
    // the credential is earned in the role, not required before applying.
    // Suppress the hard gate entirely for training programs.
    if ((job as any).isTrainingProgram) {
      // Don't gate — fall through to normal scoring
    } else if (
      // Policy: a hard credential gates ONLY when it's a genuine pre-requisite
      // you must already hold (CPA/RN/bar/Series/CDL-class). Two cases are NOT
      // dealbreakers and must not force_pass:
      //   (a) credentialSponsored — the employer provides/sponsors it post-hire
      //       ("obtain Series 7 within 120 days"); you can apply without it.
      //   (b) ubiquitous-license class — an ordinary driver's license (NOT a
      //       CDL/commercial license, which IS a real occupational pre-req).
      // Regex never reaches here for these (it sets credentialRequired=false
      // when sponsored, and never classifies an ordinary driver's license as a
      // hard credential), so this branch is regex-inert — it only corrects the
      // LLM-fed path. The sponsored heads-up is surfaced as a soft, non-gating
      // RISK_CREDENTIAL_PREFERRED in scoring; an ordinary license stays silent.
      (job as any).credentialSponsored ||
      (() => {
        const d = (job.credentialDetail || "").toLowerCase()
        return /driver'?s?\s+licen[sc]e/.test(d) && !/\bcdl\b|commercial/.test(d)
      })()
    ) {
      // Non-blocking credential — fall through to normal scoring (no gate).
    } else {
    const profileFunctionTags = profile.function_tags || []
    const statedRoles = (profile.statedInterests?.targetRoles || []).join(" ").toLowerCase()
    const statedIndustries = (profile.statedInterests?.targetIndustries || []).join(" ").toLowerCase()
    const credentialType = (job.credentialDetail || "").toLowerCase()

    // Exemption logic is credential-type-specific.
    // A legal_regulatory function tag does NOT exempt from a FINRA gate —
    // compliance/regulatory work is not the same as a securities license.
    // Each credential type requires matching evidence in the profile.

    const hasLegalCredential =
      credentialType.includes("jd") ||
      credentialType.includes("law") ||
      credentialType.includes("bar") ||
      credentialType.includes("attorney")

    const hasMedCredential =
      credentialType.includes("md") ||
      credentialType.includes("nursing") ||
      credentialType.includes("medical") ||
      credentialType.includes("clinical")

    const hasCPACredential =
      credentialType.includes("cpa") ||
      credentialType.includes("accountant")

    const hasFinraCredential =
      credentialType.includes("finra") ||
      credentialType.includes("securities") ||
      credentialType.includes("insurance license") ||
      credentialType.includes("real estate license") ||
      credentialType.includes("teaching") ||
      credentialType.includes("engineer") ||
      credentialType.includes("cdl")

    // Profile exemption — only exempt if there is specific matching evidence
    const profileExemptFromLegal =
      hasLegalCredential && (
        statedRoles.includes("law") ||
        statedRoles.includes("legal") ||
        statedRoles.includes("attorney") ||
        statedIndustries.includes("law") ||
        statedIndustries.includes("legal")
      )

    const profileExemptFromMed =
      hasMedCredential && (
        profileFunctionTags.includes("premed_clinical") ||
        statedRoles.includes("medical") ||
        statedRoles.includes("physician") ||
        statedRoles.includes("nursing")
      )

    const profileExemptFromCPA =
      hasCPACredential && (
        statedRoles.includes("cpa") ||
        statedRoles.includes("certified public accountant")
      )

    // FINRA/securities/licenses: only exempt if profile explicitly mentions
    // holding the license or actively pursuing it (e.g. "SIE expected" is
    // not the same as holding a license — still gate but softer detail)
    const profileHoldsSIE =
      /sie (exam )?(expected|completed|passed|obtained)/i.test(
        (profile as any)?.resumeText || ""
      )
    const profileExemptFromFinra = false // Never fully exempt — license must be held

    const profileIsExempt =
      profileExemptFromLegal ||
      profileExemptFromMed ||
      profileExemptFromCPA ||
      profileExemptFromFinra

    if (!profileIsExempt) {
      // Softer detail if candidate is actively pursuing the license
      const isPursuing = profileHoldsSIE && hasFinraCredential
      return {
        type: "force_pass",
        gateCode: "GATE_CREDENTIAL_REQUIRED",
        detail: isPursuing
          ? `This role requires ${job.credentialDetail || "a professional credential"} that you are working toward but do not yet hold. Most firms require this license before starting — confirm the firm's policy before applying.`
          : `This role requires ${job.credentialDetail || "a professional credential or enrollment"} that is not present in your background. Applying without this qualification will not result in an interview.`,
      }
    }
    } // end !isTrainingProgram
  } // end credentialRequired

  // Hard seniority gate — when yearsRequired is 5+ and candidate has <= 2 years,
  // the gap is structurally disqualifying regardless of keyword match.
  // This prevents misleadingly high scores on roles the candidate cannot get.
  if (
    job.yearsRequired !== null &&
    job.yearsRequired >= 5 &&
    profile.yearsExperienceApprox !== null &&
    profile.yearsExperienceApprox <= 2
  ) {
    return {
      type: "force_pass",
      gateCode: "GATE_EXPERIENCE_GAP",
      detail: `This role requires ${job.yearsRequired}+ years of experience. With approximately ${profile.yearsExperienceApprox} year${profile.yearsExperienceApprox === 1 ? "" : "s"} of experience, the gap is too large to overcome in the application process. Focus on roles targeting early-career candidates.`,
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

  // Hard no part-time — candidate explicitly wants full-time only
  if ((profile.constraints as any).hardNoPartTime && (job as any).isPartTime) {
    return {
      type: "force_pass",
      gateCode: "GATE_PARTTIME_MISMATCH",
      detail: "You are looking for full-time roles only. This posting is part-time.",
    }
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

  // Pref full-time vs contract should block Apply but not necessarily “Pass”
  if (profile.constraints.prefFullTime && job.isContract) {
    return { type: "floor_review", gateCode: "GATE_FLOOR_REVIEW_CONTRACT", detail: "Pref full-time vs contract" }
  }

  return { type: "none" }
}