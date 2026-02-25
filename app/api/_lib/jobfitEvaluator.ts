// FILE: app/api/_lib/jobfitEvaluator.ts

import { evaluateJobFit } from "../jobfit/evaluator"
import type { EvalOutput, StructuredProfileSignals, Decision, LocationConstraint } from "../jobfit/signals"
import { buildEvidencePacket } from "../jobfit/evidenceBuilder"
import { generateJobfitBullets } from "../jobfit/bulletGenerator"
import { POLICY } from "../jobfit/policy"

function iconForDecision(decision: Decision) {
  if (decision === "Apply") return "✅"
  if (decision === "Review") return "⚠️"
  return "⛔"
}

function decisionNextStep(decision: Decision): string {
  if (decision === "Apply") return "Apply. Then send 2 targeted networking messages within 24 hours."
  if (decision === "Review") return "Review. Apply only if you can reduce the risks fast."
  return "Pass. Do not apply. Put that effort into a better-fit role."
}

function riskFlagsFromCodes(risk_codes: Array<{ code: string; risk?: string }> | undefined): string[] {
  if (!Array.isArray(risk_codes) || risk_codes.length === 0) return []
  const out: string[] = []
  for (const r of risk_codes) {
    const key = String(r?.code || "").trim()
    if (!key) continue
    const mapped = (POLICY as any)?.bullets?.risk?.[key]
    out.push(String(mapped || r?.risk || "").trim())
  }
  return out.filter(Boolean).slice(0, 6)
}

export async function runJobFit(args: {
  profileText: string
  jobText: string
  profileOverrides?: Partial<StructuredProfileSignals>
}) {
  const out: EvalOutput = evaluateJobFit({
    jobText: args.jobText,
    profileText: args.profileText,
    profileOverrides: args.profileOverrides,
  })

  // Always enforce this rule at the wrapper layer too (not just route.ts):
  // If force_pass, do not show WHY bullets/codes client-facing.
  const isForcePass = out?.gate_triggered?.type === "force_pass"

  if (isForcePass) {
    return {
      decision: "Pass" as Decision,
      icon: iconForDecision("Pass"),
      score: out.score,
      bullets: [],
      risk_flags: riskFlagsFromCodes(out.risk_codes),
      next_step: decisionNextStep("Pass"),
      location_constraint: out.location_constraint as LocationConstraint,
      why_codes: [],
      risk_codes: out.risk_codes,
      gate_triggered: out.gate_triggered,
    }
  }

  // Non-forced runs: build evidence + generate bullets
  const evidence = buildEvidencePacket({
    out,
    profileText: args.profileText,
    jobText: args.jobText,
    profileOverrides: args.profileOverrides,
    id: undefined,
  })

  const { bullets: llmBullets } = await generateJobfitBullets(evidence, {
    strictGates: true,
    maxRetries: 2,
    temperature: 0.2,
    requestId: evidence.id,
  })

  const why = Array.isArray(llmBullets?.why_bullets) ? llmBullets.why_bullets : []
  const risk = Array.isArray(llmBullets?.risk_bullets) ? llmBullets.risk_bullets : []

  return {
    decision: out.decision,
    icon: iconForDecision(out.decision),
    score: out.score,
    bullets: why.slice(0, 8),
    risk_flags: risk.slice(0, 6),
    next_step: out.next_step || decisionNextStep(out.decision),
    location_constraint: out.location_constraint as LocationConstraint,
    why_codes: out.why_codes,
    risk_codes: out.risk_codes,
    gate_triggered: out.gate_triggered,
  }
}