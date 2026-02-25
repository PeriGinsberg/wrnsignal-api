// FILE: app/api/jobfit/policy.ts

export type PenaltyKey =
  | "location_mismatch_constrained"
  | "heavy_analytics_mismatch"
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

export type Severity = 1 | 2 | 3 | 4 | 5

export type PenaltyPolicy = {
  label: string
  severity: Severity
  multiplier: number
  maxStackCount?: number
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
  extraction: any
}

export const POLICY: JobFitPolicy = {
  version: "jobfit_policy_v3_2026-02-24",

  score: {
    maxScore: 97,
    minScore: 0,
    penaltyStackCap: 55,
    perPenaltySoftCap: 35,
    diminishingReturnsRate: 0.35,
  },

  thresholds: { apply: 82, review: 65 },

  downgrade: {
    enabled: true,
    applyToReviewPenaltySum: 28,
    reviewToPassPenaltySum: 40,
  },

  penalties: {
    location_mismatch_constrained: { label: "Location mismatch (constrained)", severity: 4, multiplier: 3.2, maxStackCount: 1 },
    heavy_analytics_mismatch: { label: "Analytics-heavy mismatch", severity: 4, multiplier: 3.0, maxStackCount: 1 },
    sales_mismatch: { label: "Sales mismatch", severity: 5, multiplier: 3.6, maxStackCount: 1 },
    government_mismatch: { label: "Government mismatch", severity: 5, multiplier: 3.6, maxStackCount: 1 },
    contract_mismatch: { label: "Contract mismatch", severity: 3, multiplier: 2.6, maxStackCount: 1 },
    hourly_pay_mismatch: { label: "Hourly mismatch", severity: 1, multiplier: 1.6, maxStackCount: 1 },
    missing_core_tool: { label: "Missing core tool", severity: 3, multiplier: 2.2, maxStackCount: 3 },
    missing_preferred_tool: { label: "Missing preferred tool", severity: 1, multiplier: 1.2, maxStackCount: 4 },
    missing_reporting_signals: { label: "Reporting ownership emphasis", severity: 2, multiplier: 1.8, maxStackCount: 2 },
    experience_years_gap: { label: "Years gap", severity: 3, multiplier: 2.4, maxStackCount: 1 },
    mba_required: { label: "MBA required", severity: 5, multiplier: 4.0, maxStackCount: 1 },
    grad_window_mismatch: { label: "Grad window mismatch", severity: 5, multiplier: 4.0, maxStackCount: 1 },
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
      WHY_MARKETING_ROTATION_MATCH: "The internship spans multiple marketing functions, which fits broader brand work.",
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
      RISK_REPORTING_SIGNALS: "The posting emphasizes reporting and measurement ownership that may be a stretch.",
    },
    pass: {
      GATE_GRAD_MISMATCH: "Pass. The posting is screening for a different graduation window.",
      GATE_MBA_REQUIRED: "Pass. The posting requires an MBA.",
      GATE_HARD_SALES: "Pass. The posting includes sales requirements that conflict with your constraints.",
      GATE_HARD_GOV: "Pass. The posting includes government or clearance signals that conflict with your constraints.",
      GATE_HEAVY_ANALYTICS: "Pass. This is analytics-heavy and conflicts with your stated preferences.",
    },
  },

  extraction: {}, // keep your existing extraction policy file if separate; otherwise paste your existing extraction config here
}