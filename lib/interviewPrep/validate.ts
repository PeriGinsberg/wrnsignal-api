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

/**
 * `source` decides the HEADING the page renders this under, so it has to
 * survive into the stored artifact rather than being recomputed at render
 * time from a run that may since have been rescored or deleted.
 */
export type PrepEvidence = { id: string; text: string; source: "resume" | "analysis" }

export type PrepGenerated = {
  jd_depth: "thin" | "adequate"
  exposure: {
    prove: Array<{ why_id: string; claim: string; how: string }>
    /**
     * `challenge` is DECLARATIVE: the gap stated as a fact about where the
     * candidate stands, never phrased as a question. The question form lives
     * in questions.probes and nowhere else.
     *
     * It was called `they_will_ask` and it produced the same sentence twice,
     * back to back, on the same page. Measured on a live run, all three probes
     * duplicated:
     *
     *   block 1  "...You have about 1 year. Why should we consider you for an
     *             analyst-level role?"
     *   block 2  "You have about a year of experience... Why do you think
     *             you're ready for an analyst-level position?"
     *
     * The field name was the cause. Asking for what "they will ask" gets a
     * question, and the questions block then asks for it again.
     */
    probe: Array<{ risk_id: string; challenge: string; how: string }>
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

/**
 * A BOUND, not a content judgement. 2000 characters is four paragraphs of room
 * to elaborate into, and elaboration is where invented detail lives. This does
 * not check what the answer says, only how much of it there can be.
 *
 * An over-long answer is TRUNCATED, never dropped: the model being verbose is
 * not the reader's fault, and an answer that vanishes is worse than one that
 * ends early. The real work is done by the prompt having no sentence target.
 */
const MAX_ANSWER_CHARS = 700

const text = (v: unknown, max = 1200): string =>
  typeof v === "string" ? v.trim().slice(0, max) : ""

/**
 * Model-authored prose, normalised to the house style.
 *
 * ASKED FOR IN THE PROMPT AND ENFORCED HERE, because formatting is the least
 * reliable instruction you can give a model: it complies for a few sentences
 * and then drifts. A rule that holds 90% of the time reads as a bug the other
 * 10%.
 *
 * THE DASH RULE WAS BACKWARDS IN THE FIRST VERSION, and the live output proved
 * it. Every dash Haiku actually produced was UNSPACED:
 *
 *   "budget—what systems you used"
 *   "skills—advanced Excel, financial modeling—with a track record"
 *
 * The old code only converted a spaced dash to a comma and treated an unspaced
 * one as joining two words, which would have turned that into "budget-what".
 * Backwards: an unspaced em dash is the ordinary American clause break, and
 * genuine word-joining uses a hyphen, which is a different character and is
 * left alone. So every em dash is a clause break now, whatever surrounds it.
 *
 * The one real exception is a NUMERIC RANGE, where an en dash means "to":
 * "2–3 years" must become "2-3 years", not "2, 3 years".
 *
 * MARKDOWN is stripped rather than rendered. Haiku emphasises mid-sentence
 * ("what you *have* done") and the page prints the asterisks literally. Strip
 * is simpler than teaching the renderer inline markdown, and the emphasis was
 * never asked for.
 *
 * DELIBERATELY NOT APPLIED TO EVIDENCE. Those strings are the candidate's own
 * resume lines, not the model's writing, and rewriting someone's resume to fit
 * our house style would be editing the source to match the copy of it. The live
 * scan confirms the boundary holds: 11 dashes in model output, zero in evidence.
 */
export function prose(v: unknown, max = 1200): string {
  let t = text(v, max)
  if (!t) return ""

  // 1. Markdown emphasis. Paired first, then any orphan marker left behind.
  t = t
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\*/g, "")
    .replace(/(^|[^A-Za-z0-9])__([^_]+)__(?![A-Za-z0-9])/g, "$1$2")
    .replace(/(^|[^A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g, "$1$2")
    .replace(/`/g, "")

  // 2. A numeric range is the one place a dash means "to", not a clause break.
  t = t.replace(/(\d)\s*[—–]+\s*(\d)/g, "$1-$2")

  // 3. A dash running into punctuation is standing in for nothing.
  t = t.replace(/\s*[—–]+\s*([.,!?;:])/g, "$1")

  // 4. Everything else is a clause break, spaced or not.
  t = t.replace(/\s*[—–]+\s*/g, ", ")

  return t
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim()
}

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
  const evidenceById = new Map(src.evidence.map((e) => [e.id, e]))

  const exposure = (parsed.exposure ?? {}) as any
  const questions = (parsed.questions ?? {}) as any

  const prove = (Array.isArray(exposure.prove) ? exposure.prove : [])
    .map((p: any) => ({ why_id: text(p?.why_id, 20), claim: prose(p?.claim), how: prose(p?.how) }))
    .filter((p: any) => whyIds.has(p.why_id) && p.claim)
    .slice(0, MAX_PROVE)

  // RULE 3, enforced rather than trusted: with no risks in, nothing risk-shaped
  // comes out. The id check alone already does this (every set is empty), but
  // stating it makes the guarantee legible.
  const probe = (Array.isArray(exposure.probe) ? exposure.probe : [])
    .map((p: any) => ({
      risk_id: text(p?.risk_id, 20),
      challenge: prose(p?.challenge),
      how: prose(p?.how),
    }))
    .filter((p: any) => {
      if (!riskIds.has(p.risk_id) || !p.challenge) return false
      // DECLARATIVE OR NOT AT ALL. A challenge phrased as a question is the
      // duplication this field was renamed to stop, so it rides the same
      // drop-not-fail path as an invented id: the item goes, the rest stays,
      // and the question is still available in questions.probes where it
      // belongs. Prompt rules alone would hold most of the time, and most of
      // the time is what made this a bug rather than a blemish.
      if (p.challenge.endsWith("?")) return false
      return true
    })
    .slice(0, MAX_PROBE)

  const certain = (Array.isArray(questions.certain) ? questions.certain : [])
    .map((q: any) => {
      const req_id = text(q?.req_id, 64)
      return { ref: `req:${req_id}`, req_id, question: prose(q?.question, 400) }
    })
    .filter((q: any) => reqIds.has(q.req_id) && q.question)
    .slice(0, MAX_CERTAIN)

  const probes = (Array.isArray(questions.probes) ? questions.probes : [])
    .map((q: any) => {
      const risk_id = text(q?.risk_id, 20)
      return { ref: `risk:${risk_id}`, risk_id, question: prose(q?.question, 400) }
    })
    .filter((q: any) => riskIds.has(q.risk_id) && q.question)

  const seenKinds = new Set<string>()
  const always = (Array.isArray(questions.always) ? questions.always : [])
    .map((q: any) => {
      const kind = text(q?.kind, 20)
      return { ref: `always:${kind}`, kind, question: prose(q?.question, 400) }
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
        const e = evidenceById.get(id)
        if (!e || seenIds.has(id)) continue
        seenIds.add(id)
        evidence.push({ id, text: e.text, source: e.source })
      }
      return { question_ref: text(a?.question_ref, 80), answer: prose(a?.answer, MAX_ANSWER_CHARS), evidence }
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
