// FILE: app/api/jobfit/signals.ts
//
// Canonical JobFit V3 signals + evidence contract.
// Evidence-first WHY pipeline.
// Deterministic only. No prose generation logic here.

export type Decision = "Priority Apply" | "Apply" | "Review" | "Pass"
export type LocationConstraint = "constrained" | "not_constrained" | "unclear"

export type JobFamily =
  | "Consulting"
  | "Marketing"
  | "Finance"
  | "Accounting"
  | "Analytics"
  | "Sales"
  | "Government"
  | "PreMed"
  | "Other"

// Sub-family for Finance jobs — distinguishes IB, FP&A, credit, etc.
export type FinanceSubFamily =
  | "ib"              // Investment Banking: M&A, capital markets, deal advisory
  | "fpa"             // FP&A / Corporate Finance: forecasting, variance, budgeting
  | "credit"          // Credit / underwriting: borrower analysis, default risk
  | "project_finance" // Project Finance: infrastructure, energy, tax equity
  | "asset_management"// Asset / portfolio management: fund analysis, PM
  | "other_finance"   // Finance but sub-family unclear
  | null              // Not a Finance job

export type LocationMode = "in_person" | "hybrid" | "remote" | "unclear"

export type Severity = "low" | "medium" | "high"

export type FunctionTag =
  | "brand_marketing"
  | "communications_pr"
  | "creative_design"
  | "content_social"
  | "consumer_insights_research"
  | "data_analytics_bi"
  | "growth_performance"
  | "product_marketing"
  | "sales_bd"
  | "government_cleared"
  | "legal_regulatory"
  | "finance_corp"
  | "accounting_finops"
  | "premed_clinical"
  | "operations_general"
  | "consulting_strategy"
  | "other"

export type EvidenceKind =
  | "function"
  | "execution"
  | "tool"
  | "domain"
  | "deliverable"
  | "stakeholder"
  | "environment"

export type MatchStrength = "direct" | "adjacent"

export type ProfileConstraints = {
  hardNoHourlyPay: boolean
  prefFullTime: boolean
  hardNoContract: boolean
  hardNoSales: boolean
  hardNoGovernment: boolean
  hardNoFullyRemote: boolean
  preferNotAnalyticsHeavy: boolean
}

export type ProfileEvidenceUnit = {
  id: string
  kind: EvidenceKind
  key: string
  label: string
  snippet: string
  source: "resume" | "profile"
  strength: number
  functionTag?: FunctionTag
  tags?: string[]
}

export type JobRequirementUnit = {
  id: string
  kind: EvidenceKind
  key: string
  label: string
  snippet: string
  requiredness: "core" | "supporting"
  strength: number
  functionTag?: FunctionTag
  tags?: string[]
}

export type StructuredProfileSignals = {
  targetFamilies: JobFamily[]
  constraints: ProfileConstraints
  locationPreference: {
    constrained: boolean
    mode: LocationMode
    allowedCities?: string[]
  }
  tools: string[]
  gradYear: number | null
  yearsExperienceApprox: number | null

  statedInterests?: {
    targetRoles?: string[]
    adjacentRoles?: string[]
    targetIndustries?: string[]
  }

  function_tags?: FunctionTag[]
  function_tag_evidence?: Partial<Record<FunctionTag, string[]>>
  profile_evidence_units?: ProfileEvidenceUnit[]
  financeSubFamily?: FinanceSubFamily
}

export type StructuredJobSignals = {
  rawHash: string
  jobFamily: JobFamily
  financeSubFamily: FinanceSubFamily
  analytics: { isHeavy: boolean; isLight: boolean }
  function_tags?: FunctionTag[]
  signal_debug?: {
    hits?: Record<string, number>
    notes?: string[]
  }
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
credentialRequired: boolean
  credentialDetail: string | null
  gradYearHint: number | null
  requiredTools: string[]
  preferredTools: string[]
  reportingSignals: { strong: boolean }
  requirement_units?: JobRequirementUnit[]
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

export type WhyCode = {
  code: string
  job_fact: string
  profile_fact: string
  note: string
  weight?: number
  match_key?: string
  match_kind?: EvidenceKind
  match_strength?: MatchStrength
}

export type RiskCode = {
  code: string
  job_fact: string
  profile_fact?: string | null
  risk: string
  severity: Severity
  weight?: number
}

export type GateTriggered =
  | { type: "none" }
  | { type: "force_pass"; gateCode: string; detail: string }
  | { type: "floor_review"; gateCode: string; detail: string }

export type ScoreBreakdown = {
  components?: Array<{ label: string; points: number; note: string }>
  raw_score?: number
  clamped_score?: number
}

export type EvalOutput = {
  decision: Decision
  score: number
  bullets: string[]
  risk_flags: string[]
  next_step: string
  location_constraint: LocationConstraint
  why_codes: WhyCode[]
  risk_codes: RiskCode[]
  gate_triggered: GateTriggered
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