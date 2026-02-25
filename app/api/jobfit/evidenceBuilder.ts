// FILE: app/api/jobfit/evidenceBuilder.ts

import type { EvalOutput, StructuredProfileSignals } from "./signals"

export type JobFitDecision = "Apply" | "Review" | "Pass"

export type Gate =
  | { type: "constraint_location"; detail: string }
  | { type: "other_hard_gate"; detail: string }

export type EvidencePacket = {
  id: string
  decision: JobFitDecision
  score: number
  gates: Gate[]
  job: {
    title: string | null
    company: string | null
    location: string | null
    work_model: "in_person" | "hybrid" | "remote" | "unclear"
    timeline: string | null
    function_tags: string[]
    responsibilities: string[]
    requirements: string[]
    preferred: string[]
    tools: string[]
  }
  profile: {
    headline: string | null
    target_tags: string[]
    constraints: string[]
    proof_points: string[]
    skills: string[]
    tools: string[]
    locations: string[]
  }
  drivers: {
    why_evidence: Array<{ job_fact: string; profile_fact: string; link: string }>
    risk_evidence: Array<{ job_fact: string; profile_fact: string | null; risk: string; severity: "low" | "medium" | "high" }>
  }
  output_rules: { why_min: number; why_max: number; risk_min: number; risk_max: number }
}

function safeStr(x: any): string {
  return typeof x === "string" ? x.trim() : ""
}

export function buildEvidencePacket(args: {
  out: EvalOutput
  profileText: string
  jobText: string
  profileOverrides?: Partial<StructuredProfileSignals>
  id?: string
}): EvidencePacket {
  const { out } = args

  const gates: Gate[] = []
  if (out.gate_triggered && out.gate_triggered.type !== "none") {
    gates.push({ type: "other_hard_gate", detail: safeStr(out.gate_triggered.detail) || "Gate triggered" })
  }

  if (out.location_constraint !== "unclear" && out.decision === "Pass") {
    gates.push({ type: "constraint_location", detail: `Location constraint: ${out.location_constraint}` })
  }

  const whyCodes = Array.isArray(out.why_codes) ? out.why_codes : []
  const riskCodes = Array.isArray(out.risk_codes) ? out.risk_codes : []

  const why_evidence = whyCodes.slice(0, 10).map((c) => ({
    job_fact: safeStr(c.job_fact) || "Job fact",
    profile_fact: safeStr(c.profile_fact) || "Profile fact",
    link: safeStr(c.note) || "Direct match based on structured evaluation.",
  }))

  const risk_evidence = riskCodes.slice(0, 10).map((c) => ({
    job_fact: safeStr(c.job_fact) || "Job fact",
    profile_fact: c.profile_fact ? safeStr(c.profile_fact) : null,
    risk: safeStr(c.risk) || "Execution risk based on structured evaluation.",
    severity: c.severity,
  }))

  return {
    id: args.id || `${Date.now()}`,
    decision: out.decision as JobFitDecision,
    score: out.score,
    gates,
    job: {
      title: null,
      company: null,
      location: null,
      work_model: "unclear",
      timeline: null,
      function_tags: [],
      responsibilities: [],
      requirements: [],
      preferred: [],
      tools: [],
    },
    profile: {
      headline: null,
      target_tags: [],
      constraints: [],
      proof_points: [],
      skills: [],
      tools: [],
      locations: [],
    },
    drivers: { why_evidence, risk_evidence },
    output_rules: { why_min: 3, why_max: 6, risk_min: 0, risk_max: 6 },
  }
}