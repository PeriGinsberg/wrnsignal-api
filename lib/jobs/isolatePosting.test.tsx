import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { isolatePosting } from "./isolatePosting"

const PAGE = readFileSync(join(__dirname, "__fixtures__", "bmo-linkedin-page.txt"), "utf8")

describe("isolatePosting: the BMO case", () => {
  const out = isolatePosting(PAGE)

  it("bounds the posting at both ends, so the boundaries are known not guessed", () => {
    expect(out.confidence).toBe("high")
    expect(out.looksLikePage).toBe(true)
    expect(out.source).toBe("linkedin")
  })

  it("KEEPS the posting", () => {
    expect(out.text).toContain("Global Markets Corporate")
    expect(out.text).toContain("credit approval memoranda")
    expect(out.text).toContain("0-2 years of relevant experience")
    expect(out.text).toContain("Bachelor")
  })

  it("DROPS the other postings that produced the wrong verdict", () => {
    // These three lines are the entire reason the full-page paste came back a
    // Pass citing "2+ years" and a sales-focused private banking role. None of
    // them is about the BMO job.
    expect(out.text).not.toContain("2+ years of experience in private banking")
    expect(out.text).not.toContain("5+ years of commercial lending")
    expect(out.text).not.toContain("Minimum of 3 years")
    expect(out.text).not.toMatch(/Private Banking Associate/)
    expect(out.text).not.toMatch(/Wealth Management Advisor/)
  })

  it("drops the page furniture around it", () => {
    expect(out.text).not.toMatch(/^Messaging$/m)
    expect(out.text).not.toMatch(/^Notifications$/m)
    expect(out.text).not.toMatch(/^Easy Apply$/m)
    expect(out.text).not.toMatch(/^Promoted$/m)
    expect(out.text).not.toContain("People also viewed")
    expect(out.text).not.toContain("Company insights")
    expect(out.text).not.toContain("Set alert")
    expect(out.text).not.toContain("Explore collaborative articles")
  })

  it("removes most of the page", () => {
    expect(out.removedChars).toBeGreaterThan(1000)
  })
})

describe("isolatePosting: what it must not do", () => {
  it("leaves a clean posting alone", () => {
    const clean = [
      "Analyst, Global Markets Corporate Banking",
      "BMO Capital Markets is seeking an Analyst to join the Global Markets",
      "Corporate Banking team in New York. This is an entry-level analyst role",
      "supporting coverage bankers on credit origination and portfolio monitoring.",
      "Qualifications",
      "- Bachelor's degree in finance, accounting or economics.",
      "- 0-2 years of relevant experience in corporate banking or credit.",
      "- Strong financial modeling and analytical skills, including Excel.",
      "- Excellent written and verbal communication skills.",
    ].join("\n")
    const out = isolatePosting(clean)
    expect(out.looksLikePage).toBe(false)
    expect(out.confidence).toBe("high")
    expect(out.text).toContain("0-2 years")
    expect(out.text).toContain("financial modeling")
  })

  it("never returns empty, even when an anchor matches something silly", () => {
    const tiny = "About the job\nApply\nShow more"
    const out = isolatePosting(tiny)
    expect(out.text).toBe(tiny)
    expect(out.removedChars).toBe(0)
  })

  it("keeps a sentence that merely mentions applying", () => {
    const body = [
      "About the job",
      "We are hiring an analyst to support our corporate banking team in New York.",
      "Candidates should apply now to be considered for the current cycle, and we",
      "review applications on a rolling basis throughout the autumn recruiting",
      "season. The role involves credit analysis, financial modeling and research.",
      "Qualifications include a bachelor's degree and 0-2 years of experience.",
    ].join("\n")
    const out = isolatePosting(body)
    expect(out.text).toContain("Candidates should apply now to be considered")
  })

  it("asks for a human when it can see chrome but cannot find the posting", () => {
    const noAnchor = [
      "Messaging",
      "Notifications",
      "Some Company",
      "A role that goes on for a while without any recognisable posting heading,",
      "long enough to clear the minimum length so the fallback is not what fires,",
      "and containing enough words that it could plausibly be scored by mistake.",
      "It keeps going with more filler so the body is comfortably over the floor.",
      "More filler still, because the floor is two hundred and twenty characters.",
    ].join("\n")
    const out = isolatePosting(noAnchor)
    expect(out.looksLikePage).toBe(true)
    expect(out.confidence).toBe("low")
    // The body survives in full. Unbounded, the single-line nav items still go,
    // because those are chrome wherever they sit, but nothing that could be
    // part of the posting is touched. Low confidence is what sends this to a
    // human rather than any attempt to guess harder.
    expect(out.text).toContain("A role that goes on for a while")
    expect(out.text).toContain("It keeps going with more filler")
    expect(out.text).not.toMatch(/^Messaging$/m)
  })

  it("handles empty input", () => {
    const out = isolatePosting("")
    expect(out.confidence).toBe("low")
    expect(out.text).toBe("")
  })
})
