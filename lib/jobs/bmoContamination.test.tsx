import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { isolatePosting } from "./isolatePosting"
import { extractJobSignals } from "../../app/api/jobfit/extract"

// BEFORE AND AFTER on a reconstructed BMO page.
//
// WHAT THIS FIXTURE DOES AND DOES NOT SHOW, said plainly because the difference
// changes what the fix is for.
//
// It DOES reproduce the domain contamination: the page carries three other
// adverts whose language is private banking, wealth management, assets under
// management, outbound prospecting and commission. That is the language behind
// the reported verdict calling this "a sales-focused private banking role",
// and on this fixture it reaches the extractor intact.
//
// It does NOT reproduce the reported "2+ years required". Checked both ways
// round, with the recommendation rail below the posting and above it, and the
// extractor answers 0 every time. The reason is that the range patterns in
// policy.ts are tried before the single-figure ones across the WHOLE text, so
// the posting's own "0-2 years" wins wherever the rail sits. Reproducing that
// specific claim would need the original paste.
//
// This runs the extractor rather than the whole scorer, because the scorer
// needs a profile and a Supabase round-trip. The extractor is where the damage
// was done: signals are what the score and the bullets are built from.

const PAGE = readFileSync(join(__dirname, "__fixtures__", "bmo-linkedin-page.txt"), "utf8")

/** The posting on its own, as a coach gets it by selecting only the JD. */
const CLEAN = PAGE.slice(
  PAGE.indexOf("Application Deadline"),
  PAGE.indexOf("More jobs for you"),
).trim()

describe("BMO: what the page paste put in front of the extractor", () => {
  it("BEFORE: three other jobs' worth of sales and wealth language", () => {
    const before = PAGE.toLowerCase()
    expect(before).toContain("private banking")
    expect(before).toContain("wealth management")
    expect(before).toContain("assets under management")
    expect(before).toContain("outbound prospecting")
    expect(before).toContain("commission-based")
  })

  it("BEFORE: and three foreign tenure claims", () => {
    const before = PAGE
    expect(before).toContain("2+ years of experience in private banking")
    expect(before).toContain("5+ years of commercial lending")
    expect(before).toContain("Minimum of 3 years")
  })

  it("AFTER: all of it is gone, and the posting is intact", () => {
    const after = isolatePosting(PAGE).text.toLowerCase()
    expect(after).not.toContain("private banking")
    expect(after).not.toContain("wealth management")
    expect(after).not.toContain("assets under management")
    expect(after).not.toContain("outbound prospecting")
    expect(after).not.toContain("commission-based")
    expect(after).not.toContain("5+ years of commercial lending")
    expect(after).not.toContain("minimum of 3 years")

    expect(after).toContain("corporate banking")
    expect(after).toContain("credit approval memoranda")
    expect(after).toContain("0-2 years of relevant experience")
  })
})

describe("BMO: the page paste and the clean paste now agree", () => {
  it("scores the same tenure floor", () => {
    const isolated = extractJobSignals(isolatePosting(PAGE).text)
    const clean = extractJobSignals(CLEAN)
    expect(isolated.yearsRequired).toBe(clean.yearsRequired)
    expect(isolated.yearsRequired).toBe(0)
  })

  it("keeps the whole description, exactly as the clean paste has it", () => {
    const isolated = isolatePosting(PAGE).text
    expect(isolated).toContain(CLEAN)
  })

  it("KEEPS the page header, because the location only exists there", () => {
    // LinkedIn prints company, title and location above the description and
    // the description never repeats them. Slicing straight to the posting
    // anchor turned location.city into null on real prod rows, so the header
    // is retained deliberately.
    const isolated = isolatePosting(PAGE).text
    expect(isolated).toContain("BMO Capital Markets")
    expect(isolated).toContain("Analyst, Global Markets Corporate Banking")
    expect(isolated).toContain("New York, NY")
  })

  it("but not the reader's own match score or the recruiter card", () => {
    const isolated = isolatePosting(PAGE).text
    expect(isolated).not.toContain("Skills match")
    expect(isolated).not.toContain("Your profile matches")
    expect(isolated).not.toContain("Meet the hiring team")
    expect(isolated).not.toContain("Sarah Whitfield")
    expect(isolated).not.toContain("Talent Acquisition at BMO")
  })
})
