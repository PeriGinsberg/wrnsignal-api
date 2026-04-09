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
  | "Engineering"
  | "IT_Software"
  | "Healthcare"
  | "Legal"
  | "Trades"
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

// Sub-family for Sales jobs — sales is not monolithic. Candidates who
// target medical device sales do NOT consider pharma sales a match, and
// a SaaS SDR is a different world from an industrial distribution rep.
// We use this to fire RISK_SALES_SUBSEGMENT when the profile explicitly
// targets one sales subsegment and the JD is in a different one.
export type SalesSubFamily =
  | "medical_device"  // OR/case coverage, implants, orthopedic/trauma/spinal/prosthetic, surgical equipment
  | "pharmaceutical"  // Pharma rep, drug sampling, formulary access, CSO, prescriber calls
  | "saas_tech"       // SaaS/software, SDR/BDR/AE, quota-carrying tech sales
  | "industrial_b2b"  // Industrial distribution, tangible goods B2B, manufacturing sales
  | "advertising_media" // Advertising sales, media sales, digital ad sales, publisher sales
  | "financial_services" // Wealth management sales, insurance sales, client advisor sales
  | "real_estate"     // Real estate / commercial real estate / leasing sales
  | "retail_consumer" // Retail/consumer goods sales, CPG distribution
  | "other_sales"     // Sales but sub-family unclear
  | null              // Not a Sales job

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
  | "engineering_technical"
  | "software_it"
  | "healthcare_clinical"
  | "trades_skilled"
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

// Role archetype — classifies the type of work, not the job family.
// Used to detect mismatches between what the candidate wants and what the job requires.
// "analytical"  = data, research, measurement, modeling
// "strategic"   = planning, brand strategy, GTM, consulting
// "execution"   = coordinator, content, events, operations, social
// "mixed"       = meaningful blend of 2+ archetypes
export type RoleArchetype = "analytical" | "strategic" | "execution" | "mixed" | "unclear"

export type ProfileConstraints = {
  hardNoHourlyPay: boolean
  prefFullTime: boolean
  hardNoContract: boolean
  hardNoSales: boolean
  hardNoGovernment: boolean
  hardNoFullyRemote: boolean
  preferNotAnalyticsHeavy: boolean
  // New — explicit content/execution role exclusions
  hardNoContentOnly: boolean   // "no pure social media content roles", "no coordinator roles"
  hardNoPartTime: boolean      // "full time only", "no part time"
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

  // Stated interests — now fully exposed as structured signals
  statedInterests?: {
    targetRoles?: string[]        // e.g. ["marketing analyst", "brand strategy"]
    adjacentRoles?: string[]
    targetIndustries?: string[]   // e.g. ["sports", "consumer goods"]
  }

  // Role archetype inferred from stated target roles
  // Used to detect execution/strategy/analytics mismatches
  roleArchetype?: RoleArchetype

  // Raw target roles string preserved for matching
  targetRolesRaw?: string

  function_tags?: FunctionTag[]
  function_tag_evidence?: Partial<Record<FunctionTag, string[]>>
  profile_evidence_units?: ProfileEvidenceUnit[]
  financeSubFamily?: FinanceSubFamily
  // Sub-segments of Sales the candidate explicitly targets. Parsed from
  // target_roles. Used to detect mismatch against job-side salesSubFamily.
  salesTargetSubsegments?: SalesSubFamily[]

  // Resume text — needed for some gate exemption checks
  resumeText?: string

  // Raw intake form text for fallback constraint detection in scoring
  profileHeaderText?: string
}

export type StructuredJobSignals = {
  rawHash: string
  jobTitle: string | null
  companyName: string | null
  jobFamily: JobFamily
  financeSubFamily: FinanceSubFamily
  // Sub-family for Sales jobs. Null when jobFamily is not Sales.
  salesSubFamily: SalesSubFamily
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
  credentialSponsored: boolean
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
  // Fields added for interest-alignment scoring
  isSeniorRole: boolean
  isTrainingProgram: boolean
  requiresAECExperience: boolean
  requiresDomainIndustryExperience: boolean
  detectedDomain: string | null
  // True when the JD explicitly requires prior experience at a top
  // management consulting firm or investment bank. Hard screen gate.
  requiresAdvisoryBackground: boolean
  // True when the JD asks for concrete financial modeling / valuations /
  // public-filings work — distinct from generic analysis_reporting.
  requiresFinancialModeling: boolean
  requiresSoftCredential: boolean
  softCredentialDetail: string | null
  // Job archetype — what kind of work does this role actually require day-to-day?
  // "analytical"  = data, research, measurement-heavy
  // "strategic"   = planning, brand, GTM, consulting-oriented
  // "execution"   = coordinator, content, events, operations, social-heavy
  // "mixed"       = meaningful blend
  jobArchetype: RoleArchetype
  // True when content/social/events execution makes up the majority of the role
  isContentExecutionHeavy: boolean
  // Detected industry vertical (sports, healthcare, tech, finance, etc.)
  jobIndustry: string | null
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