import { describe, it, expect } from "vitest"
import { PRACTICE_PRESETS, presetForSession, sessionAutoSends } from "./presets"
import { ANSWER_SECONDS } from "./model"
import { MAX_QUESTIONS } from "./model"

describe("the Session 1 preset", () => {
  it("is the five agreed questions, in the agreed order", () => {
    expect(presetForSession(1)?.questions).toEqual([
      "What are your greatest strengths?",
      "What is your greatest weakness?",
      "Where do you see yourself in five years?",
      "Tell me something interesting about you that's not on your resume.",
      "What three words would your friends use to describe you?",
    ])
  })

  it("is ninety seconds an answer, the same as every other round", () => {
    expect(presetForSession(1)?.seconds).toBe(ANSWER_SECONDS)
    expect(ANSWER_SECONDS).toBe(90)
  })

  it("has a title the client will recognise in their hub", () => {
    expect(presetForSession(1)?.title).toBe("Session 1 practice")
  })
})

describe("which sessions send themselves", () => {
  // The load-bearing one. Session 2 is coach-built and must stay that way;
  // if this ever returns a preset, finishing Session 2 homework would fire a
  // round the coach never chose, on top of the one they are being asked to
  // build.
  it("Session 2 does not, so it stays coach-built", () => {
    expect(presetForSession(2)).toBeNull()
    expect(sessionAutoSends(2)).toBe(false)
  })

  it("Session 1 does", () => {
    expect(sessionAutoSends(1)).toBe(true)
  })

  it("a session nobody has written a preset for does not", () => {
    expect(sessionAutoSends(3)).toBe(false)
    expect(sessionAutoSends(99)).toBe(false)
  })

  // sessionNumber() in the route falls back to 1 when a workbook states no
  // session and has no parseable template id. That fallback must not be able
  // to reach this table with junk and send somebody a Session 1 round.
  it("refuses anything that is not a whole session number", () => {
    expect(presetForSession(null)).toBeNull()
    expect(presetForSession(undefined)).toBeNull()
    expect(presetForSession(1.5)).toBeNull()
    expect(presetForSession(NaN)).toBeNull()
    expect(sessionAutoSends(null)).toBe(false)
  })
})

describe("every preset, whatever gets added later", () => {
  it("fits in a round", () => {
    for (const [session, p] of Object.entries(PRACTICE_PRESETS)) {
      expect(p.questions.length, `session ${session}`).toBeGreaterThan(0)
      expect(p.questions.length, `session ${session}`).toBeLessThanOrEqual(MAX_QUESTIONS)
    }
  })

  it("has no blank or duplicated questions", () => {
    for (const [session, p] of Object.entries(PRACTICE_PRESETS)) {
      for (const q of p.questions) expect(q.trim(), `session ${session}`).not.toBe("")
      const lower = p.questions.map((q) => q.trim().toLowerCase())
      expect(new Set(lower).size, `session ${session}`).toBe(p.questions.length)
    }
  })

  it("has a title and a positive answer time", () => {
    for (const [session, p] of Object.entries(PRACTICE_PRESETS)) {
      expect(p.title.trim(), `session ${session}`).not.toBe("")
      expect(p.seconds, `session ${session}`).toBeGreaterThan(0)
    }
  })
})
