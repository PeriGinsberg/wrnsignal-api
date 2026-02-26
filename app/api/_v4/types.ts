// -----------------------------
// Core Enums
// -----------------------------

export type WeightTier = "core" | "important" | "supporting"

export type ExecLevel = 0 | 1 | 2 | 3

export type CapabilityLabel = "high" | "moderate" | "low"

export type ViabilityLabel = "clear" | "constrained" | "blocked"

export type AlignmentLabel = "high" | "moderate" | "low"

export type DecisionLabel =
  | "priority_apply"
  | "apply"
  | "review"
  | "pass"

export type AnalyticalIntensity = "low" | "moderate" | "high"

export type DomainIntensity = "none" | "moderate" | "strong"

// -----------------------------
// Taxonomy
// -----------------------------

export interface JobCluster {
  cluster_id: string
  weight_tier: WeightTier
  confidence: number
  evidence_snippet: string
}

export interface ProfileClusterProof {
  cluster_id: string
  exec_level: ExecLevel
  depth_signals: string[]
  evidence_snippet: string
}

// -----------------------------
// Structured Job Output
// -----------------------------

export interface JobStructured {
  clusters: JobCluster[]
  required_tools: string[]
  preferred_tools: string[]
  analytical_intensity: AnalyticalIntensity
  domain: {
    tag: string | null
    intensity: DomainIntensity
    evidence_snippet?: string
  }
  eligibility: {
    grad_window?: {
      min?: string
      max?: string
    }
    location?: {
      mode: "remote" | "hybrid" | "in_person" | "unknown"
      city?: string
    }
    certifications_required?: string[]
  }
}

// -----------------------------
// Structured Profile Output
// -----------------------------

export interface ProfileStructured {
  tools: string[]
  grad?: {
    year?: number
    month?: number
  }
  declared_targets: {
    role_families: string[]
    industries: string[]
    companies: string[]
  }
  cluster_proof: ProfileClusterProof[]
}

// -----------------------------
// Scoring Outputs
// -----------------------------

export interface ClusterScoreDetail {
  cluster_id: string
  job_weight: WeightTier
  exec_level: ExecLevel
  weighted_score: number
}

export interface CapabilityResult {
  score: number
  label: CapabilityLabel
  cluster_details: ClusterScoreDetail[]
}

export interface ViabilityResult {
  label: ViabilityLabel
  reasons: string[]
}

export interface AlignmentResult {
  label: AlignmentLabel
  reasons: string[]
}

export interface DecisionResult {
  label: DecisionLabel
  reasons: string[]
}

// -----------------------------
// Final Evaluator Output
// -----------------------------

export interface V4Evaluation {
  job: JobStructured
  profile: ProfileStructured
  capability: CapabilityResult
  viability: ViabilityResult
  alignment: AlignmentResult
  decision: DecisionResult
  bullets: {
    why_bullets: string[]
    risk_bullets: string[]
    strategic_flags: string[]
  }
}