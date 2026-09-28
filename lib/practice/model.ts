// lib/practice/model.ts
//
// What a practice round is, and the rules that do not belong to any one route.

export const PRACTICE_STATUSES = ["draft", "sent", "submitted"] as const
export type PracticeStatus = (typeof PRACTICE_STATUSES)[number]

/**
 * The answer limit, in seconds.
 *
 * Ninety, because that is the rule Session 2 teaches and a practice round that
 * allowed three minutes would be teaching the opposite. The recorder stops
 * itself here rather than trusting the client to watch a clock.
 */
export const ANSWER_SECONDS = 90

/** A round with nothing in it is not worth sending. */
export const MIN_QUESTIONS = 1
/**
 * Six is a soft ceiling. Nine minutes of recording is already a big ask of
 * somebody doing this alone in their bedroom, and a round nobody finishes is
 * worse than a shorter one they do.
 */
export const MAX_QUESTIONS = 6

export const MAX_QUESTION_CHARS = 400

export type PracticeQuestion = {
  id: string
  position: number
  text: string
  source: "bank" | "custom"
}

export type PracticeTake = {
  id: string
  question_id: string
  storage_path: string
  mime: string
  duration_ms: number | null
  created_at: string
}

export type PracticeRound = {
  id: string
  coach_client_id: string
  client_profile_id: string
  coach_profile_id: string
  title: string
  status: PracticeStatus
  created_at: string
  sent_at: string | null
  submitted_at: string | null
  questions: PracticeQuestion[]
}

export type QuestionInput = { text: string; source?: "bank" | "custom" }

/**
 * Clean a submitted question list, or say why it cannot be used.
 *
 * Trims, drops blanks, caps the length, de-duplicates case-insensitively
 * keeping the first spelling, and renumbers from zero. Same posture as the
 * campaign brief's list fields: a coach pasting a list should not have to
 * tidy it first.
 */
export function cleanQuestions(
  raw: unknown,
): { ok: true; questions: { text: string; source: "bank" | "custom"; position: number }[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "questions must be a list" }

  const seen = new Set<string>()
  const out: { text: string; source: "bank" | "custom"; position: number }[] = []
  for (const item of raw) {
    const text = String(
      (item && typeof item === "object" ? (item as QuestionInput).text : item) ?? "",
    ).replace(/\s+/g, " ").trim()
    if (!text) continue
    if (text.length > MAX_QUESTION_CHARS) {
      return { ok: false, error: `A question is longer than ${MAX_QUESTION_CHARS} characters` }
    }
    const k = text.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    const source =
      item && typeof item === "object" && (item as QuestionInput).source === "bank" ? "bank" : "custom"
    out.push({ text, source, position: out.length })
  }

  if (out.length < MIN_QUESTIONS) return { ok: false, error: "Add at least one question" }
  if (out.length > MAX_QUESTIONS) return { ok: false, error: `A round holds at most ${MAX_QUESTIONS} questions` }
  return { ok: true, questions: out }
}

/**
 * The newest take per question: re-recording keeps the earlier attempts but the
 * last one is the answer.
 */
export function latestTakes(takes: PracticeTake[]): Map<string, PracticeTake> {
  const byQuestion = new Map<string, PracticeTake>()
  for (const t of takes) {
    const prev = byQuestion.get(t.question_id)
    if (!prev || t.created_at > prev.created_at) byQuestion.set(t.question_id, t)
  }
  return byQuestion
}

/** Every question answered at least once. */
export function isComplete(questions: PracticeQuestion[], takes: PracticeTake[]): boolean {
  const answered = latestTakes(takes)
  return questions.length > 0 && questions.every((q) => answered.has(q.id))
}
