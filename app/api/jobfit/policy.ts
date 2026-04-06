// FILE: app/api/jobfit/policy.ts

export type PenaltyKey =
  | "location_mismatch_constrained"
  | "sales_mismatch"
  | "government_mismatch"
  | "contract_mismatch"
  | "hourly_pay_mismatch"
  | "missing_core_tool"
  | "missing_preferred_tool"
  | "missing_reporting_signals"
  | "experience_years_gap"
  | "mba_required"
  | "grad_window_mismatch"
  | "missing_core_capability_direct_proof"
  | "missing_commercial_execution_proof"
  | "missing_required_system_proof"
  | "missing_ownership_scope_proof"
  | "credential_requirement_mismatch"
  | "finance_subfamily_mismatch"
  | "role_archetype_mismatch"
  | "content_role_conflict"

export type Severity = 1 | 2 | 3 | 4 | 5

export type PenaltyPolicy = {
  label: string
  severity: Severity
  multiplier: number
  maxStackCount?: number
}

/**
 * Extraction config MUST match what extract.ts reads:
 * - extraction.location.*
 * - extraction.internship.*
 * - extraction.analytics.*
 * - extraction.government/sales/contract/hourly/mba.*
 * - extraction.years.patterns
 * - extraction.grad.patterns
 * - extraction.credential.*
 */
export type ExtractionPolicy = {
  location: {
    constrainedPhrases: string[]
    notConstrainedPhrases: string[]
    remotePhrases: string[]
    onsitePhrases: string[]
    hybridPhrases: string[]
  }
  internship: {
    keywords: string[]
    summerKeywords: string[]
    inPersonInternKeywords: string[]
    aiToolsKeywords: string[]
    marketingRotationKeywords: string[]
  }
  analytics: {
    heavyKeywords: string[]
    lightKeywords: string[]
    optInRoleKeywords: string[]
    optOutRoleKeywords: string[]
  }
  government: { keywords: string[] }
  sales: { keywords: string[] }
  contract: { keywords: string[] }
  hourly: { keywords: string[] }
  mba: { keywords: string[] }
  years: { patterns: RegExp[] }
  grad: { patterns: RegExp[] }
  credential: {
    lawSchoolKeywords: string[]
    medSchoolKeywords: string[]
    cpaKeywords: string[]
    graduateDegreeKeywords: string[]
    // Hard gate credentials — candidate legally cannot perform role without these
    finraKeywords: string[]         // Securities / FINRA registrations
    insuranceLicenseKeywords: string[] // Life, P&C insurance licenses
    realEstateLicenseKeywords: string[] // Real estate license/broker
    teachingCredentialKeywords: string[] // Teaching certificate/license
    engineeringLicenseKeywords: string[] // PE license
    cdlKeywords: string[]           // Commercial driver's license
    // Risk-flag credentials — significant gap but not legal barrier
    cfaKeywords: string[]           // CFA charterholder
    cfpKeywords: string[]           // CFP certification
    pmpKeywords: string[]           // PMP certification
    socialWorkLicenseKeywords: string[] // LCSW / LMSW
    pharmacyLicenseKeywords: string[]   // PharmD / pharmacy license
    physicalTherapyLicenseKeywords: string[] // PT license
  }
}

export type JobFitPolicy = {
  version: string
  score: {
    maxScore: number
    minScore: number
    penaltyStackCap: number
    perPenaltySoftCap: number
    diminishingReturnsRate: number
  }
  thresholds: { apply: number; review: number }
  downgrade: { enabled: boolean; applyToReviewPenaltySum: number; reviewToPassPenaltySum: number }
  penalties: Record<PenaltyKey, PenaltyPolicy>
  tools: { core: string[]; preferred: string[] }
  bullets: {
    why: Record<string, string>
    risk: Record<string, string>
    pass: Record<string, string>
  }
  extraction: ExtractionPolicy
}

export const POLICY: JobFitPolicy = {
  version: "jobfit_policy_v4_2026-03-14",

  score: {
    maxScore: 97,
    minScore: 0,
    penaltyStackCap: 55,
    perPenaltySoftCap: 35,
    diminishingReturnsRate: 0.35,
  },

  thresholds: { apply: 77, review: 65 },

  downgrade: {
    enabled: true,
    applyToReviewPenaltySum: 28,
    reviewToPassPenaltySum: 40,
  },

  penalties: {
    location_mismatch_constrained: {
      label: "Location mismatch (constrained)",
      severity: 4,
      multiplier: 3.2,
      maxStackCount: 1,
    },
    sales_mismatch: {
      label: "Sales mismatch",
      severity: 5,
      multiplier: 3.6,
      maxStackCount: 1,
    },
    government_mismatch: {
      label: "Government mismatch",
      severity: 5,
      multiplier: 3.6,
      maxStackCount: 1,
    },
    contract_mismatch: {
      label: "Contract mismatch",
      severity: 3,
      multiplier: 2.6,
      maxStackCount: 1,
    },
    hourly_pay_mismatch: {
      label: "Hourly mismatch",
      severity: 1,
      multiplier: 1.6,
      maxStackCount: 1,
    },
    missing_core_tool: {
      label: "Missing core tool",
      severity: 3,
      multiplier: 2.2,
      maxStackCount: 3,
    },
    missing_preferred_tool: {
      label: "Missing preferred tool",
      severity: 1,
      multiplier: 1.2,
      maxStackCount: 4,
    },
    missing_reporting_signals: {
      label: "Reporting ownership emphasis",
      severity: 2,
      multiplier: 1.8,
      maxStackCount: 2,
    },
    experience_years_gap: {
      label: "Years gap",
      severity: 3,
      multiplier: 2.4,
      maxStackCount: 1,
    },
    mba_required: {
      label: "MBA required",
      severity: 5,
      multiplier: 4.0,
      maxStackCount: 1,
    },
    grad_window_mismatch: {
      label: "Grad window mismatch",
      severity: 5,
      multiplier: 4.0,
      maxStackCount: 1,
    },
    missing_core_capability_direct_proof: {
      label: "Missing core direct capability proof",
      severity: 4,
      multiplier: 2.8,
      maxStackCount: 1,
    },
    missing_commercial_execution_proof: {
      label: "Missing commercial execution proof",
      severity: 4,
      multiplier: 2.6,
      maxStackCount: 1,
    },
    missing_required_system_proof: {
      label: "Missing required system proof",
      severity: 3,
      multiplier: 2.4,
      maxStackCount: 1,
    },
    missing_ownership_scope_proof: {
      label: "Missing ownership scope proof",
      severity: 4,
      multiplier: 2.7,
      maxStackCount: 1,
    },
    credential_requirement_mismatch: {
      label: "Professional credential or enrollment required",
      severity: 5,
      multiplier: 5.0,
      maxStackCount: 1,
    },
    finance_subfamily_mismatch: {
      label: "Finance sub-family mismatch (e.g. IB vs FP&A)",
      severity: 3,
      multiplier: 2.2,
      maxStackCount: 1,
    },
    role_archetype_mismatch: {
      label: "Role type mismatch with stated interests",
      severity: 3,
      multiplier: 2.2,
      maxStackCount: 1,
    },
    content_role_conflict: {
      label: "Content-only role conflicts with candidate constraint",
      severity: 4,
      multiplier: 3.0,
      maxStackCount: 1,
    },
  },

  tools: {
    core: ["Excel", "SQL", "Python", "Tableau", "Power BI", "Google Analytics", "GA4"],
    preferred: ["Looker", "Amplitude", "Mixpanel", "HubSpot", "Salesforce", "Marketo", "Klaviyo"],
  },

  bullets: {
    why: {
      WHY_FAMILY_MATCH: "The day-to-day work matches what you are targeting.",
      WHY_MARKETING_EXECUTION: "This is execution work where you can own real deliverables.",
      WHY_MEASUREMENT_LIGHT: "Measurement shows up, but it is not positioned as a heavy analytics role.",
      WHY_LOCATION_MATCH: "The work setup and location match your stated preference.",
      WHY_EARLY_CAREER_FRIENDLY: "The requirements look realistic for an early-career candidate.",
      WHY_TOOL_MATCH: "Your current tools align with what the role actually uses.",
      WHY_SUMMER_INTERNSHIP_MATCH: "The posting is a Summer internship and matches the timeline you are targeting.",
      WHY_IN_PERSON_MATCH: "The role is in-person or hybrid, which matches your no-remote constraint.",
      WHY_AI_TOOLS_MATCH: "The posting calls out AI tools, which aligns with your AI experience or training.",
      WHY_MARKETING_ROTATION_MATCH:
        "The internship spans multiple marketing functions, which fits broader brand work.",
    },
    risk: {
      RISK_LOCATION: "Location or work setup looks misaligned with your stated constraints.",
      RISK_ANALYTICS_HEAVY: "This reads like an analytics-heavy role that conflicts with your preference.",
      RISK_SALES: "Sales responsibilities show up in the role expectations.",
      RISK_GOVERNMENT: "Government or clearance signals show up in the posting.",
      RISK_CONTRACT: "The role structure conflicts with your work-type preference.",
      RISK_HOURLY: "Compensation type may not match what you are targeting.",
      RISK_MISSING_TOOLS: "The posting lists tools you have not shown yet.",
      RISK_EXPERIENCE: "The experience requirements may be above your current level.",
      RISK_MBA: "The posting indicates an MBA requirement.",
      RISK_GRAD_WINDOW: "The graduation timing does not match what the posting is screening for.",
      RISK_REPORTING_SIGNALS:
        "The posting emphasizes reporting and measurement ownership that may be a stretch.",
      RISK_CREDENTIAL_REQUIRED:
        "The posting requires professional enrollment or credentials that are not present in your background.",
      RISK_MISSING_PROOF:
        "The role emphasizes capabilities where your profile does not yet show strong enough proof.",
    },
    pass: {
      GATE_GRAD_MISMATCH: "Pass. The posting is screening for a different graduation window.",
      GATE_MBA_REQUIRED: "Pass. The posting requires an MBA.",
      GATE_HARD_SALES: "Pass. The posting includes sales requirements that conflict with your constraints.",
      GATE_HARD_GOV: "Pass. The posting includes government or clearance signals that conflict with your constraints.",
      GATE_CREDENTIAL_REQUIRED:
        "Pass. The posting requires a professional credential or enrollment (law school, medical school, CPA, bar admission) that the profile does not show.",
      GATE_HEAVY_ANALYTICS: "Pass. This is analytics-heavy and conflicts with your stated preferences.",
    },
  },

  extraction: {
    location: {
      constrainedPhrases: ["must be located", "must reside", "required to be in", "local candidates only"],
      notConstrainedPhrases: ["anywhere", "open to location", "nationwide", "across the us"],
      remotePhrases: ["remote", "work from home", "wfh", "distributed"],
      onsitePhrases: ["on-site", "onsite", "in office", "in-office", "in-person", "based in office", "on site"],
      hybridPhrases: ["hybrid"],
    },

    internship: {
      keywords: ["intern", "internship", "intern program", "capstone project", "summer intern"],
      summerKeywords: ["summer", "summer 2026", "june", "july", "august"],
      inPersonInternKeywords: ["in-person", "in person", "based in", "office", "in office", "nyc office"],
      aiToolsKeywords: ["ai tools", "ai platforms", "artificial intelligence", "genai", "generative ai"],
      marketingRotationKeywords: [
        "pr",
        "events",
        "influencer",
        "digital marketing",
        "brand marketing",
        "global marketing",
        "partnerships",
        "visual merchandising",
        "key accounts",
      ],
    },

    analytics: {
      heavyKeywords: [
        "sql",
        "python",
        "tableau",
        "power bi",
        "spss",
        "r studio",
        "statistics",
        "statistical",
        "regression",
        "forecast",
        "modeling",
        "model development",
        "experiment",
        "experimentation",
        "a/b",
        "ab test",
        "attribution",
        "data pipeline",
        "quantitative",
        "quantitative surveys",
        "survey design",
        "survey analysis",
        "consumer research",
        "market research",
        "consumer behavior",
        "marketing insights",
        "insights role",
        "insights intern",
        "analytics tools",
        "data visualization",
        "pivot tables",
        "social listening tools",
      ],
      lightKeywords: ["reporting", "insights", "measurement", "tracking", "metrics"],
      optInRoleKeywords: [
        "analyst",
        "analytics",
        "business intelligence",
        "data science",
        "data analyst",
        "insights",
        "measurement",
        "marketing science",
      ],
      optOutRoleKeywords: [
        "territory",
        "sales rep",
        "associate sales",
        "field sales",
        "account support",
        "hospital",
        "or",
        "operating room",
        "clinical support",
        "post-sale",
        "in-service",
        "product training",
      ],
    },

    government: { keywords: ["clearance", "dod", "government", "federal", "public sector", "gs-"] },
  sales: {
  keywords: [
    "quota",
    "commission",
    "closing",
    "cold call",
    "pipeline",
    "hunter",
    "territory",
    "account ownership",
    "sales rep",
    "field sales",
  ],
},
    contract: { keywords: ["contract", "contractor", "1099", "temporary", "temp"] },
    hourly: { keywords: ["hourly", "/hour", "per hour", "/hr"] },
    mba: { keywords: ["mba required", "master of business administration required"] },

    years: {
      patterns: [
        // Range pattern — "0-2 years", "1-3 years", "0–2 years" etc.
        // We capture the MINIMUM (first number). If min is 0, extractYearsRequired
        // returns 0 which the caller treats as null (no meaningful minimum).
        /(\d+)\s*[-–]\s*\d+\s*\+?\s*(years|yrs)\s*of\s*(experience|exp)/i,
        /(\d+)\s*[-–]\s*\d+\s*\+?\s*(years|yrs)/i,
        // Explicit minimum
        /minimum\s*(\d+)\s*(years|yrs)/i,
        // Standard "N+ years of experience"
        /(\d+)\+\s*(years|yrs)\s*of\s*(experience|exp)/i,
        // Plain "N years of experience" — only if no range present
        /(\d+)\s*(years|yrs)\s*of\s*(experience|exp)/i,
      ],
    },

    grad: {
      patterns: [
        /(class of)\s*(20\d{2})/i,
        /(graduat(e|ion))\s*(20\d{2})/i,
        /(expected)\s*(graduation)\s*(20\d{2})/i,
      ],
    },

    credential: {
      lawSchoolKeywords: [
        "must be enrolled in law school",
        "current law student",
        "enrolled in an accredited law school",
        "jd candidate",
        "jd required",
        "juris doctor required",
        "must be a law student",
        "law school enrollment",
        "currently attending law school",
        "1l", "2l", "3l",
        "bar admission required",
        "licensed attorney",
        "admitted to the bar",
        "active bar license",
      ],
      medSchoolKeywords: [
        "must be enrolled in medical school",
        "md candidate",
        "md required",
        "medical degree required",
        "must be a medical student",
        "current medical student",
        "rn required",
        "registered nurse",
        "nursing license",
        "clinical license",
        "lpn", "licensed practical nurse",
        "nurse practitioner", "np required",
        "physician assistant", "pa-c",
        "emt", "paramedic certification",
        "dental license", "dds required", "dmd required",
        "occupational therapist", "ot license",
      ],
      cpaKeywords: [
        "cpa required",
        "cpa license",
        "certified public accountant required",
        "active cpa",
        "must hold a cpa",
        "cma required",
        "certified management accountant",
        "cia required",
        "certified internal auditor",
      ],
      graduateDegreeKeywords: [
        "phd required",
        "phd candidate required",
        "doctoral candidate",
        "must be enrolled in a phd",
        "master's required",
        "master's degree required",
      ],
      finraKeywords: [
        "series 3", "series 6", "series 7", "series 24", "series 57",
        "series 63", "series 65", "series 66", "series 79", "series 82",
        "series 99",
        "finra registration", "finra license", "finra registered",
        "finra series", "must be finra",
        "securities license", "securities registration",
        "investment adviser representative",
        "registered representative",
        "sie exam required", "sie required", "sie license",
        "securities industry essentials",
        "safe act", "nmls", "mortgage loan originator",
        "nationwide mortgage licensing",
      ],
      insuranceLicenseKeywords: [
        "life insurance license", "life insurance license required",
        "life insurance licensed", "must hold a life insurance license",
        "property and casualty license", "p&c license",
        "p and c license", "property & casualty license",
        "insurance license required", "active insurance license",
        "must be licensed in", "state insurance license",
        "health insurance license",
        "variable annuity license",
      ],
      realEstateLicenseKeywords: [
        "real estate license required", "real estate license",
        "must hold a real estate license", "real estate licensed",
        "active real estate license", "real estate broker license",
        "salesperson license", "realtor license",
        "state real estate license",
      ],
      teachingCredentialKeywords: [
        "teaching certificate required", "teaching license required",
        "state teaching credential", "valid teaching certificate",
        "teacher certification required", "must be certified to teach",
        "educator certification", "teaching licensure",
        "standard teaching certificate",
      ],
      engineeringLicenseKeywords: [
        "pe license", "professional engineer license",
        "professional engineer required", "licensed professional engineer",
        "pe required", "p.e. required", "p.e. license",
        "must be a licensed engineer",
        "engineering license required",
      ],
      cdlKeywords: [
        "cdl required", "commercial driver's license",
        "commercial drivers license", "class a cdl",
        "class b cdl", "cdl license required",
        "valid cdl", "must hold a cdl",
      ],
      cfaKeywords: [
        "cfa required", "cfa charterholder required",
        "cfa designation required", "must hold cfa",
        "chartered financial analyst required",
      ],
      cfpKeywords: [
        "cfp required", "cfp certification required",
        "certified financial planner required",
        "must hold cfp", "cfp designation",
      ],
      pmpKeywords: [
        "pmp required", "pmp certification required",
        "project management professional required",
        "must hold pmp", "pmp certified required",
      ],
      socialWorkLicenseKeywords: [
        "lcsw required", "licensed clinical social worker",
        "lmsw required", "licensed master social worker",
        "social work license required", "must be licensed social worker",
      ],
      pharmacyLicenseKeywords: [
        "pharmd required", "pharmacy license required",
        "licensed pharmacist", "pharmacy degree required",
        "must be a licensed pharmacist",
      ],
      physicalTherapyLicenseKeywords: [
        "pt license required", "physical therapist license",
        "licensed physical therapist", "dpt required",
        "physical therapy license required",
      ],
    }
  },
}