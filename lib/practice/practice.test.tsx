import { describe, it, expect } from "vitest"
import {
  ANSWER_SECONDS, MAX_FEEDBACK_CHARS, MAX_QUESTIONS, cleanFeedback, cleanQuestions,
  hasFeedback, isComplete, latestTakes,
  type PracticeQuestion, type PracticeTake,
} from "./model"
import { questionBank, bankTraits } from "./questionBank"
import { formatClock, pickMimeType } from "../../app/dashboard/practice/[roundId]/Recorder"

const q = (id: string, position = 0): PracticeQuestion =>
  ({ id, position, text: `Q${id}`, source: "bank" })
const take = (id: string, question_id: string, created_at: string): PracticeTake =>
  ({ id, question_id, storage_path: `p/${id}`, mime: "video/webm", duration_ms: 1000, created_at })

describe("the question bank", () => {
  it("is the twenty Session 2 questions, read from the template", () => {
    const bank = questionBank()
    expect(bank).toHaveLength(20)
    expect(bank[0].id).toBe("q01")
    expect(bank[0].text).toBe("Tell me about a time you faced a challenge.")
    expect(bank[0].trait).toBe("Resilience")
  })

  it("strips the trait out of the label rather than leaving it in the question", () => {
    // The client reads "...[Resilience]" in the workbook. A coach sending that
    // to be recorded would be asking them to answer a bracket.
    expect(questionBank().every((x) => !x.text.includes("["))).toBe(true)
    expect(bankTraits()).toContain("Teamwork")
    expect(bankTraits().length).toBeGreaterThan(8)
  })
})

describe("cleaning a question list", () => {
  it("trims, drops blanks, and renumbers from zero", () => {
    const out = cleanQuestions(["  First  ", "", "   ", "Second"])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.questions).toEqual([
      { text: "First", source: "custom", position: 0 },
      { text: "Second", source: "custom", position: 1 },
    ])
  })

  it("collapses inner whitespace, because a pasted question carries newlines", () => {
    const out = cleanQuestions(["Tell me about\n   a time"])
    expect(out.ok && out.questions[0].text).toBe("Tell me about a time")
  })

  it("de-duplicates case-insensitively, keeping the first spelling", () => {
    const out = cleanQuestions(["Tell me about a time", "TELL ME ABOUT A TIME"])
    expect(out.ok && out.questions).toHaveLength(1)
    expect(out.ok && out.questions[0].text).toBe("Tell me about a time")
  })

  it("keeps where a question came from", () => {
    const out = cleanQuestions([{ text: "From the bank", source: "bank" }, { text: "Mine" }])
    expect(out.ok && out.questions.map((x) => x.source)).toEqual(["bank", "custom"])
  })

  it("refuses an empty round and an oversized one", () => {
    expect(cleanQuestions([])).toEqual({ ok: false, error: "Add at least one question" })
    expect(cleanQuestions(["", "  "])).toEqual({ ok: false, error: "Add at least one question" })
    const many = Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => `Q${i}`)
    expect(cleanQuestions(many).ok).toBe(false)
  })

  it("refuses a question that is not a question but a document", () => {
    expect(cleanQuestions(["x".repeat(401)]).ok).toBe(false)
  })

  it("refuses something that is not a list at all", () => {
    expect(cleanQuestions("Tell me about a time").ok).toBe(false)
    expect(cleanQuestions(null).ok).toBe(false)
  })
})

describe("takes", () => {
  it("the newest take per question is the answer", () => {
    const takes = [
      take("t1", "q1", "2026-09-29T10:00:00Z"),
      take("t2", "q1", "2026-09-29T10:05:00Z"),
      take("t3", "q2", "2026-09-29T10:02:00Z"),
    ]
    const newest = latestTakes(takes)
    expect(newest.get("q1")!.id).toBe("t2")
    expect(newest.get("q2")!.id).toBe("t3")
  })

  it("a round is complete only when every question has one", () => {
    const qs = [q("q1"), q("q2", 1)]
    expect(isComplete(qs, [])).toBe(false)
    expect(isComplete(qs, [take("t1", "q1", "2026-09-29T10:00:00Z")])).toBe(false)
    expect(isComplete(qs, [
      take("t1", "q1", "2026-09-29T10:00:00Z"),
      take("t2", "q2", "2026-09-29T10:01:00Z"),
    ])).toBe(true)
  })

  it("a round with no questions is not complete", () => {
    expect(isComplete([], [])).toBe(false)
  })
})

describe("the recorder clock", () => {
  it("is minutes and seconds, not a count of seconds", () => {
    // It used to print `0:${seconds}`, so ninety seconds read "0:90" and the
    // countdown went 0:90, 0:89, which is not a time anybody recognises.
    expect(formatClock(90_000)).toBe("1:30")
    expect(formatClock(60_000)).toBe("1:00")
    expect(formatClock(59_000)).toBe("0:59")
    expect(formatClock(87_000)).toBe("1:27")
  })

  it("counts down in whole seconds and never goes below zero", () => {
    expect(formatClock(9_400)).toBe("0:10")
    expect(formatClock(1)).toBe("0:01")
    expect(formatClock(0)).toBe("0:00")
    expect(formatClock(-500)).toBe("0:00")
  })

  it("picks nothing when the browser has no MediaRecorder, rather than throwing", () => {
    // jsdom has no MediaRecorder. An empty string means "let the browser
    // choose", which is the correct fallback and what older Safari wants.
    expect(pickMimeType()).toBe("")
  })

  it("the limit is the ninety seconds Session 2 teaches", () => {
    expect(ANSWER_SECONDS).toBe(90)
  })
})

// Built from char codes so the whitespace under test survives an editor, a
// linter and a CRLF checkout unchanged. A literal escape here is the kind of
// thing a trailing-whitespace rule silently rewrites.
const NEWLINE_TAB = String.fromCharCode(10, 9, 32)
const TWO_LINES = `One${String.fromCharCode(10)}Two`

describe("written feedback", () => {
  // The release gate reads this to decide whether there is anything to send.
  // An empty box under every answer is not feedback, and a coach who opens the
  // page and closes it should not be able to release silence.
  it("is present when any one box has words in it", () => {
    expect(hasFeedback({ fb_overall: null, questions: [{ ...q("1"), fb_works: "Good pace", fb_fix: null }] })).toBe(true)
    expect(hasFeedback({ fb_overall: null, questions: [{ ...q("1"), fb_works: null, fb_fix: "Slow down" }] })).toBe(true)
    expect(hasFeedback({ fb_overall: "Nice work", questions: [q("1")] })).toBe(true)
  })

  it("is absent when every box is empty or only whitespace", () => {
    expect(hasFeedback({ fb_overall: null, questions: [q("1"), q("2")] })).toBe(false)
    expect(hasFeedback({ fb_overall: "   ", questions: [{ ...q("1"), fb_works: NEWLINE_TAB, fb_fix: "" }] })).toBe(false)
    // No questions at all, which a round cannot be in, but the gate should not
    // answer "yes" to it either.
    expect(hasFeedback({ fb_overall: "", questions: [] })).toBe(false)
  })

  it("stores an empty box as null rather than as an empty string", () => {
    // The client API asks `fb_works ?? null`, so an empty string would render
    // an empty labelled block under the answer instead of nothing.
    expect(cleanFeedback("")).toBeNull()
    expect(cleanFeedback(`   ${NEWLINE_TAB}`)).toBeNull()
    expect(cleanFeedback(null)).toBeNull()
    expect(cleanFeedback(undefined)).toBeNull()
  })

  it("trims the edges and keeps the words", () => {
    expect(cleanFeedback("  You opened well.  ")).toBe("You opened well.")
    // Newlines inside survive: the boxes render pre-wrap and a coach writing
    // three bullets expects three lines.
    expect(cleanFeedback(TWO_LINES)).toBe(TWO_LINES)
  })

  it("caps a very long note instead of rejecting it", () => {
    const long = "x".repeat(MAX_FEEDBACK_CHARS + 500)
    expect(cleanFeedback(long)?.length).toBe(MAX_FEEDBACK_CHARS)
  })
})
