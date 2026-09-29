// Fixed practice rounds, by session.
//
// WHY A PRESET AND NOT THE BANK. `questionBank()` reads the twenty Session 2
// questions out of the workbook template so a coach can pick from them. That is
// the coach-built flow and it stays that way. A preset is the other shape: a
// round nobody chooses, sent automatically when a session's homework is marked
// complete, identical for every client.
//
// Session 1 is the first. Session 3 is a matter of adding an entry here and
// nothing else: the sender reads this table, and a session with no entry
// simply does not get an automatic round, which is what keeps Session 2
// coach-built without a special case anywhere.

import { ANSWER_SECONDS } from "./model"

export type PracticePreset = {
  /** The round's title, as the client and the coach both see it. */
  title: string
  /** Seconds per answer. Held per preset so a future session can differ. */
  seconds: number
  questions: string[]
}

export const PRACTICE_PRESETS: Record<number, PracticePreset> = {
  1: {
    title: "Session 1 practice",
    seconds: ANSWER_SECONDS,
    // The five openers. Order is deliberate: strengths first because it is the
    // one everybody has an answer to, weakness second while they are warm, and
    // the two personal ones last so the round does not end on a hard question.
    questions: [
      "What are your greatest strengths?",
      "What is your greatest weakness?",
      "Where do you see yourself in five years?",
      "Tell me something interesting about you that's not on your resume.",
      "What three words would your friends use to describe you?",
    ],
  },
}

/**
 * The preset for a session, or null when that session has none.
 *
 * Null is the ordinary answer, not an error: Session 2 is coach-built on
 * purpose, and every session without an entry behaves the way Session 2 does.
 */
export function presetForSession(session: number | null | undefined): PracticePreset | null {
  if (typeof session !== "number" || !Number.isInteger(session)) return null
  return PRACTICE_PRESETS[session] ?? null
}

/** Does this session send its own round, rather than waiting for the coach? */
export function sessionAutoSends(session: number | null | undefined): boolean {
  return presetForSession(session) !== null
}
