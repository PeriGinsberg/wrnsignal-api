// lib/interviewPrep/validate.ts
//
// Parse the model's response and throw away anything it cannot support.
//
// DROP, DO NOT FAIL. Every check here removes one item and keeps the rest. A
// whole-response reject would be the KI-11 mistake again: Phase 2's grounding
// validator rejected entire outputs on ordinary English and was measured at a
// ~100% false-reject rate, which in production meant nobody got anything. These
// checks are set membership on ids the model was handed, so they cannot
// false-reject a well-formed answer — an id is either in the input or invented.
//
// What survives is by construction traceable: every drafted answer carries the
// resume lines it rests on, resolved to text HERE rather than at render time,
// so the stored artifact stays readable even if the run behind it is rescored
// or deleted.
//
// Pure. No network, no database.

import type { PrepSource } from "./source"

export type PrepEvidence = { id: string; text: string }

export type PrepGenerated = {
  jd_depth: "thin" | "adequate"
  exposure: {
    prove: Array<{ why_id: string; claim: string; how: string }>
    probe: Array<{ risk_id: string; they_will_ask: string; how: string }>
  }
  questions: {
    certain: Array<{ ref: string; req_id: string; question: string }>
    probes: Array<{ ref: string; risk_id: string; question: string }>
    always: Array<{ ref: string; kind: "why_this_job" | "why_you"; question: string }>
  }
  /** evidence is RESOLVED, so the UI renders what an answer rests on without a join. */
  answers: Array<{ question_ref: string; answer: string; evidence: PrepEvidence[] }>
}

const MAX_PROVE = 3
const MAX_PROBE = 3
const MAX_CERTAIN = 3

const text = (v: unknown, max = 1200): string =>
  typeof v === "string" ? v.trim().slice(0, max) : ""

/**
 * Pull the JSON object out of a response. invokeClaude already strips markdown
 * fences; this handles the rest — a stray sentence before the brace, which is
 * the one thing a temperature-0 model still does occasionally.
 */
export function parseResponse(raw: string): any | null {
  const a = raw.indexOf("{")
  const b = raw.lastIndexOf("}")
  if (a === -1 || b === -1 || b <= a) return null
  try {
    return JSON.parse(raw.slice(a, b + 1))
  } catch {
    return null
  }
}

/**
 * Validate against the material the model was actually given.
 *
 * Returns null when nothing usable survives — no questions at all, or no
 * answers. The caller then writes NOTHING and fails closed: a half-empty prep
 * cached forever is worse than a button the user can press again.
 */
export function validateGenerated(parsed: any, src: PrepSource): PrepGenerated | null {
  if (!parsed || typeof parsed !== "object") return null

  const whyIds = new Set(src.strengths.map((s) => s.id))
  const riskIds = new Set(src.risks.map((r) => r.id))
  const reqIds = new Set(src.requirements.map((r) => r.id))
  const evidenceById = new Map(src.evidence.map((e) => [e.id, e.text]))

  const exposure = (parsed.exposure ?? {}) as any
  const questions = (parsed.questions ?? {}) as any

  const prove = (Array.isArray(exposure.prove) ? exposure.prove : [])
    .map((p: any) => ({ why_id: text(p?.why_id, 20), claim: text(p?.claim), how: text(p?.how) }))
    .filter((p: any) => whyIds.has(p.why_id) && p.claim)
    .slice(0, MAX_PROVE)

  // RULE 3, enforced rather than trusted: with no risks in, nothing risk-shaped
  // comes out. The id check alone already does this (every set is empty), but
  // stating it makes the guarantee legible.
  const probe = (Array.isArray(exposure.probe) ? exposure.probe : [])
    .map((p: any) => ({
      risk_id: text(p?.risk_id, 20),
      they_will_ask: text(p?.they_will_ask),
      how: text(p?.how),
    }))
    .filter((p: any) => riskIds.has(p.risk_id) && p.they_will_ask)
    .slice(0, MAX_PROBE)

  const certain = (Array.isArray(questions.certain) ? questions.certain : [])
    .map((q: any) => {
      const req_id = text(q?.req_id, 64)
      return { ref: `req:${req_id}`, req_id, question: text(q?.question, 400) }
    })
    .filter((q: any) => reqIds.has(q.req_id) && q.question)
    .slice(0, MAX_CERTAIN)

  const probes = (Array.isArray(questions.probes) ? questions.probes : [])
    .map((q: any) => {
      const risk_id = text(q?.risk_id, 20)
      return { ref: `risk:${risk_id}`, risk_id, question: text(q?.question, 400) }
    })
    .filter((q: any) => riskIds.has(q.risk_id) && q.question)

  const seenKinds = new Set<string>()
  const always = (Array.isArray(questions.always) ? questions.always : [])
    .map((q: any) => {
      const kind = text(q?.kind, 20)
      return { ref: `always:${kind}`, kind, question: text(q?.question, 400) }
    })
    .filter((q: any) => {
      if (q.kind !== "why_this_job" && q.kind !== "why_you") return false
      if (!q.question) return false
      if (seenKinds.has(q.kind)) return false // one each, not two of the same
      seenKinds.add(q.kind)
      return true
    }) as PrepGenerated["questions"]["always"]

  // An answer can only exist for a question that survived. Answering a dropped
  // question would put text on the page with no question above it.
  const liveRefs = new Set<string>([
    ...certain.map((q: any) => q.ref),
    ...probes.map((q: any) => q.ref),
    ...always.map((q) => q.ref),
  ])

  const seenAnswers = new Set<string>()
  const answers = (Array.isArray(parsed.answers) ? parsed.answers : [])
    .map((a: any) => {
      const ids: string[] = Array.isArray(a?.evidence_ids)
        ? a.evidence_ids.map((x: unknown) => text(x, 20))
        : []
      // Resolve and drop unknown ids in one pass. An id the model invented has
      // no text behind it, which is precisely what makes this checkable.
      const evidence: PrepEvidence[] = []
      const seenIds = new Set<string>()
      for (const id of ids) {
        const t = evidenceById.get(id)
        if (!t || seenIds.has(id)) continue
        seenIds.add(id)
        evidence.push({ id, text: t })
      }
      return { question_ref: text(a?.question_ref, 80), answer: text(a?.answer, 2000), evidence }
    })
    .filter((a: any) => {
      if (!liveRefs.has(a.question_ref)) return false
      if (!a.answer) return false
      // THE GROUNDING CHECK. An answer with nothing behind it is exactly the
      // fabrication this whole file guards against, so it goes.
      if (a.evidence.length === 0) return false
      if (seenAnswers.has(a.question_ref)) return false
      seenAnswers.add(a.question_ref)
      return true
    })

  const anyQuestions = certain.length + probes.length + always.length > 0
  if (!anyQuestions || answers.length === 0) return null

  return {
    jd_depth: parsed.jd_depth === "thin" ? "thin" : "adequate",
    exposure: { prove, probe },
    questions: { certain, probes, always },
    answers,
  }
}
