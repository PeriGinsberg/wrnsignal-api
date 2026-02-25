// FILE: app/api/_lib/jobfitEvaluator.ts

import { evaluateJobFit } from "../jobfit/evaluator"
import type { EvalOutput, StructuredProfileSignals, Decision, LocationConstraint } from "../jobfit/signals"
import { buildEvidencePacket } from "../jobfit/evidenceBuilder"
import { generateJobfitBullets } from "../jobfit/bulletGenerator"

function iconForDecision(decision: Decision) {
  if (decision === "Apply") return "✅"
  if (decision === "Review") return "⚠️"
  return "⛔"
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

  return {
    decision: out.decision,
    icon: iconForDecision(out.decision),
    score: out.score,
    bullets: llmBullets.why_bullets.slice(0, 8),
    risk_flags: llmBullets.risk_bullets.slice(0, 6),
    next_step: out.next_step,
    location_constraint: out.location_constraint as LocationConstraint,
    why_codes: out.why_codes,
    risk_codes: out.risk_codes,
    gate_triggered: out.gate_triggered,
  }
}