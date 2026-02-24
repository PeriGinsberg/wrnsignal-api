// jobfit/signals.ts

export type WhyCode =
  | "WHY_FAMILY_MATCH"
  | "WHY_MARKETING_EXECUTION"
  | "WHY_MEASUREMENT_LIGHT"
  | "WHY_LOCATION_MATCH"
  | "WHY_EARLY_CAREER_FRIENDLY"
  | "WHY_TOOL_MATCH"
  // internship-specific
  | "WHY_SUMMER_INTERNSHIP_MATCH"
  | "WHY_IN_PERSON_MATCH"
  | "WHY_AI_TOOLS_MATCH"
  | "WHY_MARKETING_ROTATION_MATCH"

export type RiskCode =
  | "RISK_LOCATION"
  | "RISK_ANALYTICS_HEAVY"
  | "RISK_SALES"
  | "RISK_GOVERNMENT"
  | "RISK_CONTRACT"
  | "RISK_HOURLY"
  | "RISK_MISSING_TOOLS"
  | "RISK_EXPERIENCE"
  | "RISK_MBA"
  | "RISK_GRAD_WINDOW"
  | "RISK_REPORTING_SIGNALS"

export type JobFamily =
  | "Marketing"
  | "Finance"
  | "Accounting"
  | "Analytics"
  | "PreMed"
  | "Sales"
  | "Government"
  | "Other"

export type LocationMode = "remote" | "onsite" | "hybrid" | "unclear"

export type StructuredJobSignals = {
  rawHash: string

  jobFamily: JobFamily
  analytics: { isHeavy: boolean; isLight: boolean }

  // Added city + evidence so bullets can be specific without guessing.
  location: {
    mode: LocationMode
    constrained: boolean
    city?: string | null
    evidence?: string | null
  }

  isGovernment: boolean
  isSalesHeavy: boolean
  isContract: boolean
  isHourly: boolean

  internship: {
    isInternship: boolean
    isSummer: boolean
    isInPersonExplicit: boolean
    mentionsAITools: boolean
    isMarketingRotation: boolean

    // New evidence fields to drive non-generic bullets
    departments?: string[]
    dates?: string | null
    pay?: string | null
    hasCapstone?: boolean
    evidence?: {
      internshipLine?: string | null
      inPersonLine?: string | null
      aiLine?: string | null
      deptLine?: string | null
      capstoneLine?: string | null
      payLine?: string | null
      dateLine?: string | null
    }
  }

  yearsRequired: number | null
  mbaRequired: boolean
  gradYearHint: number | null

  requiredTools: string[]
  preferredTools: string[]

  reportingSignals: { strong: boolean }
}

export type StructuredProfileSignals = {
  rawHash: string

  targetFamilies: JobFamily[]

  // Add allowedCities for constraint matching (you already had it optional)
  locationPreference: {
    mode: LocationMode
    constrained: boolean
    allowedCities?: string[]
  }

  constraints: {
    hardNoSales: boolean
    hardNoGovernment: boolean
    hardNoContract: boolean
    hardNoHourlyPay: boolean
    hardNoFullyRemote: boolean
    prefFullTime: boolean
    preferNotAnalyticsHeavy: boolean
  }

  gradYear: number | null
  yearsExperienceApprox: number | null

  tools: string[]
}

export type WhyItem = { code: WhyCode; text: string }
export type RiskItem = { code: RiskCode; text: string }

export type EvalOutput = {
  decision: "Apply" | "Review" | "Pass"
  score: number
  bullets: string[]
  risk_flags: string[]
  next_step: string
  location_constraint: "constrained" | "not_constrained" | "unclear"
  why_codes: WhyCode[]
  risk_codes: RiskCode[]
  gate_triggered: { type: "force_pass" | "floor_review" | "none"; gateCode?: string }
}