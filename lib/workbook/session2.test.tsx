import { describe, it, expect } from "vitest"
import {
  computeCoverage, isFilled, optionsFromAnswers, progress, sectionFieldKeys,
  sectionOptionalKeys, selectValues, validateAnswerValue, validateContent,
  type Block, type WorkbookContent,
} from "./content"
import raw from "./templates/session-2-telling-your-stories.json"

const parsed = validateContent(raw)
if (!parsed.ok) throw new Error(parsed.errors.join("; "))
const t: WorkbookContent = parsed.content
const section = (id: string) => t.sections.find((s) => s.id === id)!
const blocks = t.sections.flatMap((s) => s.blocks as Block[])

describe("the Session 2 template", () => {
  it("is a session 2 template, which is what the homework webhook reads", () => {
    // sessionNumber() in the homework-complete route takes content.session
    // first. Getting this wrong sends the coach the wrong session.
    expect(t.session).toBe(2)
    expect(t.template_id).toBe("session-2-telling-your-stories")
  })

  it("has the nine sections from the spec, in the right modes", () => {
    expect(t.sections.map((s) => s.mode)).toEqual([
      "in_session", "in_session", "in_session", "in_session", "in_session", "in_session",
      "homework", "homework", "homework",
    ])
  })

  it("ships eight story slots and no more", () => {
    const slots = blocks.filter((b) => b.type === "story" && b.key.startsWith("s2.story"))
    expect(slots).toHaveLength(8)
  })

  it("copies the two live-built stories into slots 1 and 2, and nothing else", () => {
    const copies = blocks
      .filter((b): b is Extract<Block, { type: "story" }> => b.type === "story")
      .filter((b) => b.copy_from)
    expect(copies.map((b) => [b.key, b.copy_from])).toEqual([
      ["s2.story1", "s2.q1"],
      ["s2.story2", "s2.q2"],
    ])
  })

  it("matches twenty questions against the client's own story names", () => {
    const sel = section("match").blocks.filter(
      (b): b is Extract<Block, { type: "select" }> => b.type === "select",
    )
    expect(sel).toHaveLength(20)
    expect(sel.every((b) => b.options_from === "s2.story*.name")).toBe(true)
  })
})

describe("optional fields stay out of the progress bar", () => {
  it("excludes reflection and the out-loud timing", () => {
    const optional = sectionOptionalKeys(section("builder"))
    expect(optional).toContain("s2.story1.reflection")
    expect(optional).not.toContain("s2.story1.s")
    expect(optional).not.toContain("s2.story1.e")
    // Section 2's scratch notes are marked optional on the field itself.
    expect(sectionOptionalKeys(section("star"))).toEqual(["s2.star.notes"])
  })

  it("a client who answers everything required reaches 100%", () => {
    const answers: Record<string, unknown> = {}
    const optional = new Set(sectionOptionalKeys(section("star")))
    for (const k of sectionFieldKeys(section("star"))) {
      if (!optional.has(k)) answers[k] = "done"
    }
    const p = progress({ sections: [section("star")] }, answers)
    expect(p.filled).toBe(p.total)
    // NOT asserting the nav tick. Section 2's only writable field is the
    // optional scratch note, so once optional keys leave the denominator the
    // section has nothing required in it at all, and `sectionsDone` has always
    // skipped sections with no required fields (Section 1 is pure text and has
    // never ticked either). Whether those should tick is a product question,
    // not something to change quietly here.
  })

  it("the timing field still saves, it just is not owed", () => {
    expect(sectionFieldKeys(section("challenge"))).toContain("s2.q1.seconds")
    expect(sectionOptionalKeys(section("challenge"))).toContain("s2.q1.seconds")
  })
})

describe("select options", () => {
  it("flattens grouped traits to the choosable values", () => {
    const story = blocks.find(
      (b): b is Extract<Block, { type: "story" }> => b.type === "story",
    )!
    const values = selectValues(story.traits)
    expect(values).toContain("Teamwork")
    expect(values).toContain("Analytical thinking")
    expect(values).toHaveLength(15)
    // Group headers are not choices.
    expect(values).not.toContain("How you work with people")
  })

  it("builds the Section 8 list from story names, in slot order, deduped", () => {
    const out = optionsFromAnswers("s2.story*.name", {
      "s2.story2.name": "The group project",
      "s2.story10.name": "The late shift",
      "s2.story1.name": "The torn Achilles",
      "s2.story3.name": "  ",
      "s2.story4.name": "The group project",
    })
    expect(out).toEqual(["The torn Achilles", "The group project", "The late shift"])
  })

  it("a multi-select answer is a list, and an empty list is unanswered", () => {
    expect(isFilled(["School"])).toBe(true)
    expect(isFilled([])).toBe(false)
    expect(validateAnswerValue(t, "s2.great.areas", ["School", "Work"])).toBeNull()
    expect(validateAnswerValue(t, "s2.great.areas", ["Atlantis"])).toMatch(/not one of the options/)
    expect(validateAnswerValue(t, "s2.great.areas", "School")).toMatch(/must be a list/)
  })

  it("a single select is held to its options, but options_from is not", () => {
    expect(validateAnswerValue(t, "s2.story1.trait", "Teamwork")).toBeNull()
    expect(validateAnswerValue(t, "s2.story1.trait", "Juggling")).toMatch(/not one of the options/)
    // The Section 8 list is the client's own answers, which change as they
    // type, so a closed list cannot be enforced here.
    expect(validateAnswerValue(t, "s2.match.q01.story", "Anything they named")).toBeNull()
  })
})

describe("coverage", () => {
  const cfg = blocks.find((b) => b.type === "coverage") as Extract<Block, { type: "coverage" }>

  it("reports every question as uncovered when nothing is matched", () => {
    const rows = computeCoverage(cfg, {})
    const unanswered = rows.find((r) => r.label === "Questions with no story yet")!
    expect(unanswered.items).toHaveLength(20)
    expect(unanswered.items[0]).toBe("q01 (Resilience)")
  })

  it("flags a story carrying four or more questions", () => {
    const answers: Record<string, unknown> = { "s2.story1.name": "The torn Achilles" }
    for (const q of ["q01", "q02", "q03", "q04"]) answers[`s2.match.${q}.story`] = "The torn Achilles"
    const rows = computeCoverage(cfg, answers)
    expect(rows.find((r) => r.label === "Stories you are leaning on too hard")!.items)
      .toEqual(["The torn Achilles (4 questions)"])
  })

  it("does not flag three", () => {
    const answers: Record<string, unknown> = { "s2.story1.name": "A" }
    for (const q of ["q01", "q02", "q03"]) answers[`s2.match.${q}.story`] = "A"
    const rows = computeCoverage(cfg, answers)
    expect(rows.find((r) => r.label === "Stories you are leaning on too hard")).toBeUndefined()
  })

  it("names the trait groups with nothing behind them", () => {
    const rows = computeCoverage(cfg, {
      "s2.story1.name": "A", "s2.story1.trait": "Teamwork", "s2.story1.life_area": "Work",
    })
    const groups = rows.find((r) => r.label === "Groups with no story")!.items
    expect(groups).toEqual([
      "How you handle hard things", "How you get things done", "How you learn and think",
    ])
    expect(groups).not.toContain("How you work with people")
  })

  it("only mentions life areas once one is carrying more than half", () => {
    const even: Record<string, unknown> = {
      "s2.story1.name": "A", "s2.story1.life_area": "Work",
      "s2.story2.name": "B", "s2.story2.life_area": "School",
    }
    expect(computeCoverage(cfg, even).find((r) => r.label === "Parts of your life with no story"))
      .toBeUndefined()

    const lopsided: Record<string, unknown> = {
      "s2.story1.name": "A", "s2.story1.life_area": "Work",
      "s2.story2.name": "B", "s2.story2.life_area": "Work",
      "s2.story3.name": "C", "s2.story3.life_area": "School",
    }
    const items = computeCoverage(cfg, lopsided)
      .find((r) => r.label === "Parts of your life with no story")!.items
    expect(items).toContain("Sports")
    expect(items).not.toContain("Work")
    expect(items).not.toContain("School")
  })

  it("says nothing at all when everything is covered", () => {
    const answers: Record<string, unknown> = {}
    const traits = selectValues(cfg.trait_groups)
    traits.forEach((trait, i) => {
      answers[`s2.story${i + 1}.name`] = `Story ${i + 1}`
      answers[`s2.story${i + 1}.trait`] = trait
      answers[`s2.story${i + 1}.life_area`] = ["School", "Work", "Sports", "Clubs and activities", "Volunteering", "Personal life"][i % 6]
    })
    Object.keys(cfg.question_traits).forEach((q, i) => {
      answers[`s2.match.${q}.story`] = `Story ${(i % traits.length) + 1}`
    })
    expect(computeCoverage(cfg, answers)).toEqual([])
  })

  it("owns no field keys, so it cannot be answered or counted", () => {
    expect(sectionFieldKeys(section("match")).filter((k) => k.includes("coverage"))).toEqual([])
  })
})
