// jobfit/signals.ts

export type WhyCode =
  | "WHY_FAMILY_MATCH"
  | "WHY_MARKETING_EXECUTION"
  | "WHY_MEASUREMENT_LIGHT"
  | "WHY_LOCATION_MATCH"
  | "WHY_EARLY_CAREER_FRIENDLY"
  | "WHY_TOOL_MATCH"

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
  location: { mode: LocationMode; constrained: boolean }
  isGovernment: boolean
  isSalesHeavy: boolean
  isContract: boolean
  isHourly: boolean

  yearsRequired: number | null
  mbaRequired: boolean

  gradYearHint: number | null // if job explicitly screens for class year or graduation year
  requiredTools: string[] // normalized tokens
  preferredTools: string[]
  reportingSignals: { strong: boolean }
}

export type StructuredProfileSignals = {
  rawHash: string

  targetFamilies: JobFamily[]
  locationPreference: { mode: LocationMode; constrained: boolean; allowedCities?: string[] }
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

  tools: string[] // normalized tokens
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
  gate_triggered: { type: "force_pass" | "floor_review" | "none"; gateCode?: string } // debug
}