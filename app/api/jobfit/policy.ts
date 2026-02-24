// jobfit/policy.ts

import { RiskCode, WhyCode } from "./signals"

export type Decision = "Apply" | "Review" | "Pass"

export type LocationConstraint = "constrained" | "not_constrained" | "unclear"

export type Gate =
  | { type: "force_pass"; reason: string; gateCode: string }
  | { type: "floor_review"; reason: string; gateCode: string }
  | { type: "none" }

export type PenaltyKey =
  | "location_mismatch_constrained"
  | "location_mismatch_unclear"
  | "heavy_analytics_mismatch"
  | "sales_mismatch"
  | "government_mismatch"
  | "remote_policy_mismatch"
  | "contract_mismatch"
  | "hourly_pay_mismatch"
  | "missing_core_tool"
  | "missing_preferred_tool"
  | "missing_reporting_signals"
  | "experience_years_gap"
  | "mba_required"
  | "grad_window_mismatch"

export type Severity = 1 | 2 | 3 | 4 | 5

export type PenaltyPolicy = {
  label: string
  severity: Severity
  multiplier: number
  maxStackCount?: number // cap stacking of same penalty type
}

export type ToolPolicy = {
  core: string[] // if job requires these and profile lacks them, higher penalty
  preferred: string[] // softer penalty
}

export type JobFitPolicy = {
  version: string

  score: {
    startScore: number // starts high
    maxScore: number // hard ceiling (97)
    minScore: number // floor (0)
    penaltyStackCap: number // max total penalty deducted regardless of stacking
    perPenaltySoftCap: number // soft cap for penalty sum before diminishing returns
    diminishingReturnsRate: number // 0.0 to 1.0
  }

  thresholds: {
    apply: number
    review: number
  }

  downgrade: {
    enabled: boolean
    applyToReviewPenaltySum: number
    reviewToPassPenaltySum: number
  }

  penalties: Record<PenaltyKey, PenaltyPolicy>

  tools: ToolPolicy

  bullets: {
    why: Record<WhyCode, string>
    risk: Record<RiskCode, string>
    pass: Record<string, string> // gateCode -> template
  }

  extraction: {
    location: {
      constrainedPhrases: string[]
      notConstrainedPhrases: string[]
      remotePhrases: string[]
      onsitePhrases: string[]
      hybridPhrases: string[]
    }
    analytics: {
      heavyKeywords: string[]
      lightKeywords: string[]
    }
    government: {
      keywords: string[]
    }
    sales: {
      keywords: string[]
    }
    contract: {
      keywords: string[]
    }
    hourly: {
      keywords: string[]
    }
    mba: {
      keywords: string[]
    }
    years: {
      patterns: RegExp[]
    }
    grad: {
      patterns: RegExp[]
    }
  }
}

export const POLICY: JobFitPolicy = {
  version: "jobfit_policy_v1_2026-02-24",

  score: {
    startScore: 92,
    maxScore: 97,
    minScore: 0,
    penaltyStackCap: 55,
    perPenaltySoftCap: 35,
    diminishingReturnsRate: 0.35,
  },

  thresholds: {
    apply: 82,
    review: 65,
  },

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
    location_mismatch_unclear: {
      label: "Possible location mismatch",
      severity: 2,
      multiplier: 2.0,
      maxStackCount: 1,
    },
    heavy_analytics_mismatch: {
      label: "Role is analytics-heavy vs profile preferences",
      severity: 4,
      multiplier: 3.0,
      maxStackCount: 1,
    },
    sales_mismatch: {
      label: "Role has sales requirements vs profile constraints",
      severity: 5,
      multiplier: 3.6,
      maxStackCount: 1,
    },
    government_mismatch: {
      label: "Government/cleared environment vs profile constraints",
      severity: 5,
      multiplier: 3.6,
      maxStackCount: 1,
    },
    remote_policy_mismatch: {
      label: "Remote preference mismatch",
      severity: 3,
      multiplier: 2.4,
      maxStackCount: 1,
    },
    contract_mismatch: {
      label: "Contract vs full-time preference",
      severity: 3,
      multiplier: 2.6,
      maxStackCount: 1,
    },
    hourly_pay_mismatch: {
      label: "Hourly pay vs preference",
      severity: 2,
      multiplier: 1.8,
      maxStackCount: 1,
    },
    missing_core_tool: {
      label: "Missing core tool requirement",
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
      label: "Role emphasizes reporting/measurement signals not present",
      severity: 2,
      multiplier: 1.8,
      maxStackCount: 2,
    },
    experience_years_gap: {
      label: "Years of experience requirement gap",
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
      label: "Graduation window mismatch",
      severity: 5,
      multiplier: 4.0,
      maxStackCount: 1,
    },
  },

  tools: {
    core: ["Excel", "SQL", "Python", "Tableau", "Power BI", "Google Analytics", "GA4"],
    preferred: ["Looker", "Amplitude", "Mixpanel", "HubSpot", "Salesforce", "Marketo", "Klaviyo"],
  },

  bullets: {
    why: {
      WHY_FAMILY_MATCH: "The role aligns with your target job family and day-to-day work.",
      WHY_MARKETING_EXECUTION: "The work is execution-oriented and maps to real deliverables you can own.",
      WHY_MEASUREMENT_LIGHT: "Measurement is present, but it is not positioned as a heavy analytics role.",
      WHY_LOCATION_MATCH: "The location and work setup match your stated preference.",
      WHY_EARLY_CAREER_FRIENDLY: "The requirements look realistic for an early-career candidate.",
      WHY_TOOL_MATCH: "Your tool stack matches what the role actually uses.",
    },
    risk: {
      RISK_LOCATION: "Location or work setup looks misaligned with your stated constraints.",
      RISK_ANALYTICS_HEAVY: "This reads like an analytics-heavy role that may not match what you want to do.",
      RISK_SALES: "Sales responsibilities show up in the role expectations.",
      RISK_GOVERNMENT: "Government or clearance signals show up in the posting.",
      RISK_CONTRACT: "The role structure (contract) conflicts with your full-time preference.",
      RISK_HOURLY: "Compensation type may not match what you are targeting.",
      RISK_MISSING_TOOLS: "Some tools in the posting do not show up in your profile.",
      RISK_EXPERIENCE: "The experience requirements may be above your current level.",
      RISK_MBA: "The posting indicates an MBA requirement.",
      RISK_GRAD_WINDOW: "The graduation timing does not match what the posting is screening for.",
      RISK_REPORTING_SIGNALS: "The posting emphasizes reporting and measurement signals that may not be your strength yet.",
    },
    pass: {
      GATE_GRAD_MISMATCH: "Pass. The posting is screening for a different graduation window.",
      GATE_MBA_REQUIRED: "Pass. The posting requires an MBA.",
      GATE_HARD_SALES: "Pass. The posting includes sales requirements that conflict with your constraints.",
      GATE_HARD_GOV: "Pass. The posting includes government or clearance signals that conflict with your constraints.",
      GATE_HEAVY_ANALYTICS: "Pass. This is an analytics-heavy role and conflicts with your stated preferences.",
    },
  },

  extraction: {
    location: {
      constrainedPhrases: ["must be located", "must reside", "required to be in", "local candidates only"],
      notConstrainedPhrases: ["anywhere", "open to location", "nationwide", "across the us"],
      remotePhrases: ["remote", "work from home", "wfh", "distributed"],
      onsitePhrases: ["on-site", "onsite", "in office", "in-office"],
      hybridPhrases: ["hybrid"],
    },
    analytics: {
      heavyKeywords: [
        "sql",
        "python",
        "statistics",
        "regression",
        "experiment",
        "a/b",
        "forecast",
        "modeling",
        "data pipeline",
        "dashboard ownership",
        "kpi ownership",
        "attribution",
      ],
      lightKeywords: ["reporting", "insights", "measurement", "tracking", "metrics"],
    },
    government: { keywords: ["clearance", "dod", "government", "federal", "public sector", "gs-"] },
    sales: { keywords: ["quota", "commission", "closing", "cold call", "pipeline", "hunters", "business development"] },
    contract: { keywords: ["contract", "contractor", "1099", "temporary"] },
    hourly: { keywords: ["hourly", "$/hour", "per hour"] },
    mba: { keywords: ["mba required", "master of business administration required"] },
    years: {
      patterns: [
        /(\d+)\+?\s*(years|yrs)\s*of\s*(experience|exp)/i,
        /minimum\s*(\d+)\s*(years|yrs)/i,
      ],
    },
    grad: {
      patterns: [
        /(class of)\s*(20\d{2})/i,
        /(graduat(e|ion))\s*(20\d{2})/i,
        /(expected)\s*(graduation)\s*(20\d{2})/i,
      ],
    },
  },
}