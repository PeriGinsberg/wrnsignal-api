// FILE: app/api/_lib/jobfitEvaluator.ts

import { evaluateJobFit } from "../jobfit/evaluator"
import type { EvalOutput, StructuredProfileSignals, Decision, LocationConstraint } from "../jobfit/signals"
import { buildEvidencePacket } from "../jobfit/evidenceBuilder"
import { generateJobfitBullets } from "../jobfit/bulletGenerator"
import { POLICY } from "../jobfit/policy"

export const JOBFIT_EVAL_WRAPPER_STAMP = "JOBFIT_EVAL_WRAPPER_STAMP__2026_02_26__A"
console.log("[jobfitEvaluator] loaded:", JOBFIT_EVAL_WRAPPER_STAMP)

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

/* ----------------------- bullet policy enforcement ----------------------- */

const BANNED_PHRASES = [
  "evidence packet",
  "as indicated",
  "correspond",
  "reinforcing",
  "supporting a review decision",
  "supporting the review decision",
  "this supports",
  "this suggests",
]

function norm(s: string): string {
  return String(s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
}

function sanitizeBullet(s: string): string {
  let t = norm(s)
  t = t.replace(/^[\-\u2022•\s]+/, "")
  t = t.replace(/\s{2,}/g, " ").trim()
  if (t.length > 0) t = t[0].toUpperCase() + t.slice(1)
  return t
}

function isUsableBullet(s: string): boolean {
  const t = norm(s)
  if (!t) return false
  if (t.length < 12) return false
  const low = t.toLowerCase()
  for (const bad of BANNED_PHRASES) {
    if (low.includes(bad)) return false
  }
  return true
}

function dedupeKey(s: string): string {
  const low = norm(s).toLowerCase()
  const cleaned = low.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
  const stop = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "for", "with", "on", "at", "by", "from", "as"])
  const toks = cleaned
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((t) => !stop.has(t))
  return toks.slice(0, 10).join(" ")
}

function maxWhyBullets(decision: Decision): number {
  if (decision === "Review") return 3
  if (decision === "Apply") return 3
  return 0
}

function maxRiskBullets(decision: Decision): number {
  if (decision === "Apply") return 3
  if (decision === "Review") return 4
  return 0
}

function postProcess(raw: string[], cap: number): string[] {
  if (cap <= 0) return []
  const cleaned: string[] = []
  for (const b of raw) {
    const s = sanitizeBullet(b)
    if (!isUsableBullet(s)) continue
    cleaned.push(s)
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const b of cleaned) {
    const k = dedupeKey(b)
    if (!k) continue
    if (seen.has(k)) continue
    seen.add(k)
    out.push(b)
    if (out.length >= cap) break
  }
  return out
}

/* ----------------------- MAIN EXPORT ----------------------- */

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

  // Enforce: if force_pass, do not show WHY bullets/codes client-facing.
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

  const whyRaw = Array.isArray(llmBullets?.why_bullets) ? llmBullets.why_bullets : []
  const riskRaw = Array.isArray(llmBullets?.risk_bullets) ? llmBullets.risk_bullets : []

  const why = postProcess(whyRaw, maxWhyBullets(out.decision))
  const risk = postProcess(riskRaw, maxRiskBullets(out.decision))

  return {
    decision: out.decision,
    icon: iconForDecision(out.decision),
    score: out.score,
    bullets: why,
    risk_flags: risk,
    next_step: out.next_step || decisionNextStep(out.decision),
    location_constraint: out.location_constraint as LocationConstraint,
    why_codes: out.why_codes,
    risk_codes: out.risk_codes,
    gate_triggered: out.gate_triggered,
  }
}