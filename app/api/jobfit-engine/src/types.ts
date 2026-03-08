// src/types.ts

export type EngineVersion = "v1.0"

export type Decision = "PRIORITY_APPLY" | "APPLY" | "REVIEW" | "PASS"
export type Alignment = "STRONG" | "MODERATE" | "WEAK" | "MISALIGNED"
export type Exposure = "EXECUTED" | "ADJACENT" | "THEORETICAL" | "NONE"

export type RiskLevel = "COSMETIC" | "ADDRESSABLE_GAP" | "STRUCTURAL"
export type FlagSeverity = "INFO" | "WARNING" | "BLOCKING"

export type JobSource = "linkedin" | "greenhouse" | "lever" | "hand_input" | "other"

export type SeniorityHint =
  | "intern"
  | "entry"
  | "early"
  | "mid"
  | "senior"
  | "lead"
  | "manager"
  | "director"
  | "exec"
  | "unknown"

export type EmploymentTypeHint =
  | "internship"
  | "full_time"
  | "part_time"
  | "contract"
  | "unknown"

export type WorkAuthRestrictionType =
  | "none"
  | "us_only"
  | "requires_sponsorship_not_available"
  | "must_have_work_auth"
  | "unknown"

export type LocationMode = "onsite" | "hybrid" | "remote" | "unspecified"

/* ----------------------------- External API Contract ----------------------------- */

export interface JobFitRequestV1 {
  engine_version: EngineVersion
  job: {
    job_id: string
    source: JobSource
    title: string
    company: string
    description_raw: string
  }
  profile_id: string
}

export interface WhyItem {
  code: string
  label: string
  evidence: string
}

export interface RiskItem {
  risk_level: RiskLevel
  code: string
  label: string
  evidence: string
  mitigation: string
}

export interface FlagItem {
  flag: string
  severity: FlagSeverity
  detail: string
}

export interface DebugBlock {
  fingerprint: string
  gates: {
    hard_fail: boolean
    hard_fail_reasons: string[]
  }
  alignment: Alignment
  exposure: Exposure
  otherwise_qualified: boolean
}

export interface JobFitResponseV1 {
  engine_version: EngineVersion
  job_id: string
  profile_id: string

  decision: Decision
  score: number

  why: WhyItem[]
  risks: RiskItem[]
  flags: FlagItem[]
  next_step: string

  debug: DebugBlock
}

/* ----------------------------- Internal Engine Contracts ----------------------------- */

export interface JobSignalsV1 {
  schema_version: EngineVersion
  job_id: string

  normalized: {
    title: string
    company: string
    description: string
  }

  role: {
    seniority_hint: SeniorityHint
    employment_type_hint: EmploymentTypeHint
    role_families: string[]
  }

  requirements: {
    experience: {
      min_years: number | null
      max_years: number | null
      is_explicit: boolean
      evidence: string[]
    }

    education: {
      is_required: boolean
      degree_level_min: "none" | "associate" | "bachelor" | "master" | "phd" | "unknown"
      fields_preferred: string[]
      evidence: string[]
    }

    gpa: {
      is_required: boolean
      minimum: number | null
      evidence: string[]
    }

    certifications: {
      required: string[]
      preferred: string[]
      evidence: string[]
    }

    work_authorization: {
      is_specified: boolean
      restriction_type: WorkAuthRestrictionType
      evidence: string[]
    }

    location: {
      mode: LocationMode
      is_hard_requirement: boolean
      evidence: string[]
    }
  }

  skills_tools: {
    tools_required: string[]
    tools_preferred: string[]
    skills_required: string[]
    skills_preferred: string[]
  }

  responsibility_clusters: string[]

  extraction_quality: {
    confidence_overall: "high" | "medium" | "low"
    warnings: string[]
  }
}

export interface ProfileSignalsV1 {
  schema_version: EngineVersion
  profile_id: string

  profile_type: "student" | "early_career" | "experienced" | "unknown"

  targets: {
    role_families: string[]
    industries: string[]
    domains: string[]
  }

  education: {
    degree_level: "none" | "associate" | "bachelor" | "master" | "phd" | "in_progress" | "unknown"
    majors: string[]
    grad_year: number | null
    gpa: number | null
  }

  experience: {
    years_total_est: number | null
    years_relevant_est: number | null
    internships_count: number | null
    full_time_roles_count: number | null
  }

  skills_tools: {
    tools: string[]
    skills: string[]
  }

  certifications: string[]

  work_authorization: {
    status: "us_citizen" | "permanent_resident" | "needs_sponsorship" | "has_work_auth" | "unknown"
  }

  location_preferences: {
    preferred_regions: string[]
    remote_ok: boolean
    onsite_ok: boolean
  }

  exposure_clusters: {
    executed: string[]
    adjacent: string[]
    theoretical: string[]
  }

  resume_fingerprint: string
}

/* ----------------------------- Regression Runner Types ----------------------------- */

export interface JobSignalsV1 {
  // ...
  priority_apply?: {
    is_priority: boolean
    reasons?: string[]
  }
}

export interface RegressionCase {
  case_id: string
  profile_id: string
  job_id: string

  expected_decision: Decision
  expected_alignment: Alignment
  expected_exposure: Exposure

  expected_structural_risk_codes: string[]
  expected_tier2_risk_count: number

  expected_misalignment_cap_applied: boolean
  expected_hard_gate_triggered: boolean

  expected_gpa_flag: "None" | "Missing" | "Below_Min"

  notes?: string

  // Minimal inputs for engine execution (in runner)
  profile: ProfileSignalsV1
  job: JobSignalsV1
}

export interface RegressionResult {
  case_id: string
  pass: boolean
  failures: string[]
}