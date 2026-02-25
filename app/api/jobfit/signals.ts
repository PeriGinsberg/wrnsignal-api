// FILE: app/api/jobfit/signals.ts
//
// Canonical JobFit V3 signals + evidence contract.
// This file MUST match what extract.ts produces and what scoring/gates/evaluator consume.
// No UI display fields here (title/company/responsibilities). Those belong in evidenceBuilder / LLM layer.

export type Decision = "Apply" | "Review" | "Pass"
export type LocationConstraint = "constrained" | "not_constrained" | "unclear"

export type JobFamily =
  | "Marketing"
  | "Finance"
  | "Accounting"
  | "Analytics"
  | "Sales"
  | "Government"
  | "PreMed"
  | "Other"

export type LocationMode = "in_person" | "hybrid" | "remote" | "unclear"

export type Severity = "low" | "medium" | "high"

export type ProfileConstraints = {
  hardNoHourlyPay: boolean
  prefFullTime: boolean
  hardNoContract: boolean
  hardNoSales: boolean
  hardNoGovernment: boolean
  hardNoFullyRemote: boolean
  preferNotAnalyticsHeavy: boolean
}

export type StructuredProfileSignals = {
  targetFamilies: JobFamily[]
  constraints: ProfileConstraints
  locationPreference: {
    constrained: boolean
    mode: LocationMode
    allowedCities?: string[] // optional, NOT required
  }
  tools: string[]
  gradYear: number | null
  yearsExperienceApprox: number | null
}

export type StructuredJobSignals = {
  rawHash: string

  jobFamily: JobFamily
  analytics: { isHeavy: boolean; isLight: boolean }
  location: {
    mode: LocationMode
    constrained: boolean
    city: string | null
    evidence: string | null
  }

  isGovernment: boolean
  isSalesHeavy: boolean
  isContract: boolean
  isHourly: boolean

  yearsRequired: number | null
  mbaRequired: boolean
  gradYearHint: number | null

  requiredTools: string[]
  preferredTools: string[]

  reportingSignals: { strong: boolean }

  internship?: {
    isInternship: boolean
    isSummer: boolean
    isInPersonExplicit: boolean
    mentionsAITools: boolean
    isMarketingRotation: boolean
    departments: string[]
    dates: string | null
    pay: string | null
    hasCapstone: boolean
    evidence: {
      internshipLine: string | null
      inPersonLine: string | null
      aiLine: string | null
      deptLine: string | null
      capstoneLine: string | null
      payLine: string | null
      dateLine: string | null
    }
  }
}

// Evidence objects emitted by deterministic scoring (no prose bullets here)
export type WhyCode = {
  code: string
  job_fact: string
  profile_fact: string
  note: string
  weight?: number
}

export type RiskCode = {
  code: string
  job_fact: string
  profile_fact?: string | null
  risk: string
  severity: Severity
  weight?: number
}

// Gates
export type GateTriggered =
  | { type: "none" }
  | { type: "force_pass"; gateCode: string; detail: string }
  | { type: "floor_review"; gateCode: string; detail: string }

// Optional score breakdown (debug)
export type ScoreBreakdown = {
  components?: Array<{ label: string; points: number; note: string }>
  raw_score?: number
  clamped_score?: number
}

// Evaluator output contract (engine output; wrapper fills bullets/risk_flags via bullet generator)
export type EvalOutput = {
  decision: Decision
  score: number

  // Legacy UI fields (engine returns [])
  bullets: string[]
  risk_flags: string[]

  next_step: string
  location_constraint: LocationConstraint

  why_codes: WhyCode[]
  risk_codes: RiskCode[]

  gate_triggered: GateTriggered

  // Optional debug/trace fields
  job_signals?: StructuredJobSignals
  profile_signals?: StructuredProfileSignals
  score_breakdown?: ScoreBreakdown
}

export function emptyEvalOutput(): EvalOutput {
  return {
    decision: "Review",
    score: 50,
    bullets: [],
    risk_flags: [],
    next_step: "Proceed to Positioning →",
    location_constraint: "unclear",
    why_codes: [],
    risk_codes: [],
    gate_triggered: { type: "none" },
  }
}