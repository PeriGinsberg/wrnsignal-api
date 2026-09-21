// The workbook renderers, against Ryan's real content file.
//
// Pinned: the hook sentence fills in live, coach_only never renders for the
// client, a coach note sits beside its block, empty summary answers show a
// muted placeholder instead of vanishing, and the checklist reports ticks.

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SectionBlocks, type FieldApi } from "../../../components/workbook/Blocks"
import { Summary } from "../../../components/workbook/Summary"
import { validateContent, type WorkbookContent } from "../../../lib/workbook/content"

afterEach(cleanup)

const parsed = validateContent(JSON.parse(readFileSync(
  join(__dirname, "../../../docs/workbooks-v1/workbooks-v1/ryan-hecht_skyhawks-le-coordinator.json"), "utf8")))
if (!parsed.ok) throw new Error(parsed.errors.join("; "))
const c: WorkbookContent = parsed.content
const section = (id: string) => c.sections.find((s) => s.id === id)!

function api(values: Record<string, unknown>, over: Partial<FieldApi> = {}): FieldApi {
  return {
    editable: true,
    get: (k) => values[k],
    set: vi.fn(),
    state: () => undefined,
    coachName: "Peri",
    showCoachOnly: false,
    ...over,
  }
}

describe("SectionBlocks", () => {
  it("fills the hook sentence in as the answer is typed", () => {
    render(<SectionBlocks api={api({ "hook.final": "has been to all 50 states" })} section={section("hook")} />)
    expect(screen.getByText(/Oh yeah, Ryan\. The guy who has been to all 50 states\./)).toBeTruthy()
  })

  it("shows the blank while the hook is empty", () => {
    render(<SectionBlocks api={api({})} section={section("hook")} />)
    expect(screen.getByText(/The guy who ______\./, { selector: "p.wb-hook-line" })).toBeTruthy()
  })

  it("sends typing through set()", () => {
    const set = vi.fn()
    render(<SectionBlocks api={api({}, { set })} section={section("hook")} />)
    fireEvent.change(screen.getByLabelText("My hook"), { target: { value: "x" } })
    expect(set).toHaveBeenCalledWith("hook.final", "x")
  })

  it("never renders a coach_only block for the client", () => {
    render(<SectionBlocks api={api({})} section={section("hard")} />)
    expect(screen.queryByText(/Hawks Smile Maker/)).toBeNull()
  })

  it("shows the coach_only block when asked (coach view)", () => {
    render(<SectionBlocks api={api({}, { showCoachOnly: true })} section={section("hard")} />)
    expect(screen.getByText(/Hawks Smile Maker/)).toBeTruthy()
  })

  it("renders a coach note with the coach's name", () => {
    render(<SectionBlocks api={api({})} section={section("hook")} />)
    expect(screen.getByText("Not your resume. Not a strength. Something uniquely you.")).toBeTruthy()
    expect(screen.getAllByText("Peri").length).toBeGreaterThan(0)
  })

  it("renders every STAR part as a labelled field", () => {
    render(<SectionBlocks api={api({})} section={section("stories")} />)
    expect(screen.getAllByLabelText("Situation")).toHaveLength(7)
    expect(screen.getAllByLabelText("That experience taught me...")).toHaveLength(7)
  })

  it("is read-only when not editable", () => {
    render(<SectionBlocks api={api({ "hook.q1": "triplet" }, { editable: false })} section={section("hook")} />)
    expect((screen.getByLabelText(/surprises people/) as HTMLTextAreaElement).readOnly).toBe(true)
  })
})

describe("Summary", () => {
  it("shows answers where they exist and a muted placeholder where they do not", () => {
    render(<Summary content={c} answers={{ "tmay.present": "Senior at UGA", "hr.strength": "Calm under pressure" }} interview={null} />)
    expect(screen.getByText("Senior at UGA")).toBeTruthy()
    expect(screen.getByText("Calm under pressure")).toBeTruthy()
    expect(screen.getAllByText("Not filled in yet").length).toBeGreaterThan(5)
  })

  it("puts the interview row ahead of the content file", () => {
    render(<Summary content={c} answers={{}} interview={{ interviewer_names: "Jordan Lee", company_name: "College Park Skyhawks", job_title: "LE&P Coordinator" }} />)
    expect(screen.getByText("Jordan Lee")).toBeTruthy()
    expect(screen.getByText("LE&P Coordinator, College Park Skyhawks")).toBeTruthy()
  })

  it("reports checklist ticks", () => {
    const onCheck = vi.fn()
    render(<Summary content={c} answers={{}} interview={null} onCheck={onCheck} />)
    fireEvent.click(screen.getByLabelText("Phone on silent"))
    expect(onCheck).toHaveBeenCalledWith(4, true)
  })

  it("maps each story to its STAR title", () => {
    render(<Summary content={c} answers={{ "star.plan.story": "Braves bobblehead night" }} interview={null} />)
    expect(screen.getByText("Owning the plan")).toBeTruthy()
    expect(screen.getByText("Braves bobblehead night")).toBeTruthy()
  })
})
