// lib/academy/rubric.ts
//
// The case evaluation rubric: ten dimensions, each scored 1 to 5, with
// behavioural anchors at 1, 3 and 5. Shared by the coach review screen and the
// export, so the scale the coach used and the scale ChatGPT is given are the
// same words. Safe for client components: it is a scale, not an answer key.

import type { DimensionKey } from "./types"

export type Dimension = {
  key: DimensionKey
  label: string
  anchors: { 1: string; 3: string; 5: string }
}

export const DIMENSIONS: Dimension[] = [
  {
    key: "problem_understanding",
    label: "Problem understanding",
    anchors: {
      1: "Restates the prompt or answers a different question. Misses the constraint.",
      3: "Gets the objective right but leaves out a constraint or what success looks like.",
      5: "One or two sentences: the objective, the constraint, and what a good answer would decide.",
    },
  },
  {
    key: "structuring",
    label: "Logical structuring",
    anchors: {
      1: "No visible structure, or a memorised framework that does not fit the question.",
      3: "Sensible buckets, but overlapping or too many, or announced without being used.",
      5: "Two to four distinct buckets built for this question, stated up front and then followed.",
    },
  },
  {
    key: "prioritization",
    label: "Prioritization",
    anchors: {
      1: "Treats every factor as equally important. No 'first' or 'most'.",
      3: "Names a priority, but late, or without saying why.",
      5: "Says what matters most first and gives the reason in one line.",
    },
  },
  {
    key: "hypothesis",
    label: "Hypothesis development",
    anchors: {
      1: "Collects data with no point of view about what it will show.",
      3: "Offers a hypothesis but does not say how to test it.",
      5: "A clear, testable hypothesis and the one piece of data that would confirm or kill it.",
    },
  },
  {
    key: "brainstorming",
    label: "Brainstorming quality",
    anchors: {
      1: "A short, unsorted list, or ideas that ignore the constraint.",
      3: "Plenty of ideas, loosely grouped, with weak or missing selection.",
      5: "Practical ideas in clear groups, then two picks with reasons tied to the objective and the constraint.",
    },
  },
  {
    key: "quant_accuracy",
    label: "Quantitative accuracy",
    anchors: {
      1: "Wrong setup or wrong answer, and does not catch it.",
      3: "Right setup, a slip in the arithmetic or the units, caught or nearly caught.",
      5: "States the equation, works it cleanly, gets it right, sanity-checks the size.",
    },
  },
  {
    key: "business_interpretation",
    label: "Business interpretation",
    anchors: {
      1: "Stops at the number.",
      3: "Says whether the number is good or bad, without the 'so what' or the caveat.",
      5: "Says what the number means for the decision and which assumption it hangs on.",
    },
  },
  {
    key: "conciseness",
    label: "Conciseness",
    anchors: {
      1: "Long preamble, repeats points, uses most of the time to reach the point.",
      3: "Gets there, with some filler or a second lap round the same idea.",
      5: "Leads with the answer and stops when it is made. Every sentence earns its place.",
    },
  },
  {
    key: "clarity",
    label: "Communication clarity",
    anchors: {
      1: "Hard to follow: no signposting, ideas run together.",
      3: "Followable, but the listener has to work to find the structure.",
      5: "Signposted ('three things', 'first'), easy to note down, confident pace.",
    },
  },
  {
    key: "recommendation",
    label: "Final recommendation",
    anchors: {
      1: "No clear recommendation, or a summary of the case instead of a decision.",
      3: "A recommendation with reasons, but missing the risk or the next step.",
      5: "Decision first, two reasons, one real risk, a concrete next step, in about a minute.",
    },
  },
]

export type RubricEntry = { score: number | null; note: string }
export type Rubric = Partial<Record<DimensionKey, RubricEntry>>

export type CoachReview = {
  strengths: string
  priorities: string
  drills: string
  summary: string
}

export const REVIEW_FIELDS: { key: keyof CoachReview; label: string; placeholder: string }[] = [
  { key: "strengths", label: "Overall strengths", placeholder: "What to keep doing on Wednesday." },
  { key: "priorities", label: "Development priorities", placeholder: "The two or three things that would move the score most." },
  { key: "drills", label: "Suggested drills", placeholder: "What to practise before Tuesday's simulation." },
  { key: "summary", label: "Final coaching summary", placeholder: "The paragraph you would read out at the start of Sunday's session." },
]

const MAX_NOTE = 4000

/** A rubric from the wire, cleaned: known dimensions, whole scores 1-5 or null, capped notes. */
export function cleanRubric(raw: unknown): Rubric {
  const out: Rubric = {}
  if (!raw || typeof raw !== "object") return out
  for (const d of DIMENSIONS) {
    const v = (raw as Record<string, any>)[d.key]
    if (!v || typeof v !== "object") continue
    const n = Number(v.score)
    const score = Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
    const note = String(v.note ?? "").slice(0, MAX_NOTE)
    if (score !== null || note.trim()) out[d.key] = { score, note }
  }
  return out
}

export function cleanReview(raw: unknown): CoachReview {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return {
    strengths: String(r.strengths ?? "").slice(0, MAX_NOTE),
    priorities: String(r.priorities ?? "").slice(0, MAX_NOTE),
    drills: String(r.drills ?? "").slice(0, MAX_NOTE),
    summary: String(r.summary ?? "").slice(0, MAX_NOTE * 2),
  }
}

/** Mean of the scored dimensions, one decimal, or null when none are scored. */
export function rubricAverage(r: Rubric | null | undefined): number | null {
  const scores = Object.values(r ?? {}).map((e) => e?.score).filter((s): s is number => typeof s === "number")
  if (!scores.length) return null
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
}
