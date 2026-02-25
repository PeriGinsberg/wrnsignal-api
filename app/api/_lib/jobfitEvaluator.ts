// app/api/_lib/jobfitEvaluator.ts

// app/api/_lib/jobfitEvaluator.ts

import { evaluateJobFit } from "../jobfit/evaluator"
import type { EvalOutput, StructuredProfileSignals } from "../jobfit/signals"
import { buildEvidencePacket } from "../jobfit/evidenceBuilder"
import { generateJobfitBullets } from "../jobfit/bulletGenerator"

// Keep legacy UI contract (UI depends on this shape)
type Decision = "Apply" | "Review" | "Pass"
type LocationConstraint = "constrained" | "not_constrained" | "unclear"

function iconForDecision(decision: Decision) {
  if (decision === "Apply") return "✅"
  if (decision === "Review") return "⚠️"
  return "⛔"
}

/**
 * Deterministic JobFit runner.
 * Compatibility wrapper around /jobfit/* engine.
 */
export async function runJobFit({
  profileText,
  jobText,
  profileOverrides,
}: {
  profileText: string
  jobText: string
  profileOverrides?: Partial<StructuredProfileSignals>
}) {
  const out: EvalOutput = evaluateJobFit({
    jobText,
    profileText,
    profileOverrides,
  })
  const evidence = buildEvidencePacket({
    out,
    profileText,
    jobText,
    profileOverrides,
  id: undefined,
  })

  const { bullets: llmBullets } = await generateJobfitBullets(evidence, {
    strictGates: true,
    maxRetries: 2,
    temperature: 0.2,
    requestId: evidence.id,
  })
console.log("JOBFIT V3 DEBUG:", {
  decision: out.decision,
  score: out.score,
  gates: evidence.gates,
  why_count: llmBullets.why_bullets.length,
  risk_count: llmBullets.risk_bullets.length,
})
    return {
    decision: out.decision as Decision,
    icon: iconForDecision(out.decision as Decision),
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