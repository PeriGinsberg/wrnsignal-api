import { describe, it, expect } from "vitest"
import { extractJobSignals } from "../../app/api/jobfit/extract"

// PINNING BEHAVIOUR THAT WAS ALREADY CORRECT.
//
// The BMO Pass reported "2+ years required" against a posting that says "0-2
// years", which looks exactly like a parser reading the top of a range as a
// floor. It was not. Every case below already passed before any change here:
// the "2+" was read out of a DIFFERENT posting sitting in the pasted page, in
// the "More jobs for you" rail. See lib/jobs/isolatePosting.ts.
//
// These stay as a guard, because the range lookbehinds in policy.ts are subtle
// enough that a later edit could plausibly break them, and the symptom would be
// this same wrong verdict with a different cause.

function years(text: string): number | null {
  return extractJobSignals(text).yearsRequired ?? null
}

describe("yearsRequired: ranges read as their MINIMUM", () => {
  it("0-2 is entry level, not two", () => {
    expect(years("We are seeking a candidate with 0-2 years of relevant experience.")).toBe(0)
    expect(years("We are seeking a candidate with 0-2 years experience.")).toBe(0)
  })

  it("0-1 year, singular", () => {
    expect(years("0-1 year of relevant experience.")).toBe(0)
  })

  it("1-3 reads as one, in every dash and the written form", () => {
    expect(years("Requires 1-3 years of professional experience.")).toBe(1)
    expect(years("Requires 1–3 years of professional experience.")).toBe(1)
    expect(years("Requires 1—3 years of professional experience.")).toBe(1)
    expect(years("Requires 1 to 3 years of experience.")).toBe(1)
  })
})

describe("yearsRequired: floors and ceilings are different things", () => {
  it("2+ is a floor of two", () => {
    expect(years("Must have 2+ years of experience in corporate banking.")).toBe(2)
    expect(years("Must have 2+ years experience.")).toBe(2)
  })

  it("minimum N is a floor", () => {
    expect(years("Minimum of 5 years of experience required.")).toBe(5)
    expect(years("At least 3 years of experience.")).toBe(3)
  })

  it("up to N is a CEILING, so it sets no requirement at all", () => {
    expect(years("Up to 2 years of postgraduate experience.")).toBeNull()
    expect(years("up to 2 years experience preferred")).toBeNull()
  })

  it("an age floor is not a tenure floor", () => {
    expect(years("Must be at least 18 years of age.")).toBeNull()
  })
})

describe("yearsRequired: the contamination case", () => {
  it("reads the posting range, not a neighbouring advert", () => {
    // The two sentences the BMO page put next to each other. Whichever one is
    // in the scored text is the one that wins, which is precisely why the fix
    // belongs in isolation rather than in this parser.
    expect(years("0-2 years of relevant experience in corporate banking.")).toBe(0)
    expect(years("2+ years of experience in private banking or wealth management required.")).toBe(2)
  })
})
