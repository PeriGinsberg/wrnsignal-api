// The practice blocks, rendered from Sami's real Deloitte bootcamp file.
//
// Pinned: a knowledge check saves only on Check and then locks with its
// explanation, a math answer is read the way people type money, the example
// answer stays locked until the client has written their own, the video tick
// saves "1", sorting compares only once every item is placed, and the coach's
// Results view shows the first attempt next to the expected answer.

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SectionBlocks, youtubeEmbed, type FieldApi } from "../../../components/workbook/Blocks"
import { PracticeResults } from "../../../components/workbook/PracticeResults"
import { validateContent, type WorkbookContent } from "../../../lib/workbook/content"

afterEach(cleanup)

const parsed = validateContent(JSON.parse(readFileSync(
  join(__dirname, "../../../docs/workbooks-v1/workbooks-v1/sami-zivitz_deloitte-case-bootcamp-01.json"), "utf8")))
if (!parsed.ok) throw new Error(parsed.errors.join("; "))
const c: WorkbookContent = parsed.content
const section = (id: string) => c.sections.find((s) => s.id === id)!

function api(values: Record<string, unknown>, over: Partial<FieldApi> = {}): FieldApi {
  return {
    editable: true, get: (k) => values[k], all: () => values, set: vi.fn(), state: () => undefined,
    coachName: "Peri", showCoachOnly: false, ...over,
  }
}

describe("quiz", () => {
  it("saves nothing until Check, then saves the choice", () => {
    const set = vi.fn()
    render(<SectionBlocks api={api({}, { set })} section={section("m1-welcome")} />)
    const option = screen.getByLabelText(/Ask a few questions to understand the problem/)
    fireEvent.click(option)
    expect(set).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole("button", { name: "Check my answer" })[0])
    expect(set).toHaveBeenCalledWith("m1.q1", "Ask a few questions to understand the problem, such as the time period and whether costs went up")
  })

  it("once answered, locks and explains, right or wrong", () => {
    render(<SectionBlocks api={api({ "m1.q1": "Recommend closing the weakest stores" })} section={section("m1-welcome")} />)
    expect(screen.getByText("Not quite. Here is why.")).toBeTruthy()
    expect(screen.getByText(/A recommendation|recommending store closures would be a guess/)).toBeTruthy()
    expect((screen.getByLabelText("Recommend closing the weakest stores") as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText("Best answer")).toBeTruthy()
  })

  it("a select-all question saves a list", () => {
    const set = vi.fn()
    render(<SectionBlocks api={api({}, { set })} section={section("m1-welcome")} />)
    fireEvent.click(screen.getByLabelText("Ask a question when something is unclear"))
    fireEvent.click(screen.getByLabelText("Say your thinking out loud as you work"))
    fireEvent.click(screen.getAllByRole("button", { name: "Check my answer" })[2])
    expect(set).toHaveBeenCalledWith("m1.q3", ["Ask a question when something is unclear", "Say your thinking out loud as you work"])
  })
})

describe("math", () => {
  it("checks a typed answer and explains the working", () => {
    const set = vi.fn()
    const { rerender } = render(<SectionBlocks api={api({}, { set })} section={section("m4-guided-case")} />)
    const input = screen.getByLabelText(/By what percent did it fall/)
    fireEvent.change(input, { target: { value: "33.3%" } })
    const checks = screen.getAllByRole("button", { name: "Check my answer" })
    fireEvent.click(checks[checks.length - 1])
    expect(set).toHaveBeenCalledWith("m4.pct", "33.3%")
    rerender(<SectionBlocks api={api({ "m4.pct": "50" })} section={section("m4-guided-case")} />)
    expect(screen.getByText("Not quite. Here is how it works.")).toBeTruthy()
    expect(screen.getByText(/Why divide by 12 and not 8/)).toBeTruthy()
  })

  it("will not check something that is not a number", () => {
    render(<SectionBlocks api={api({})} section={section("m6-case-math")} />)
    fireEvent.change(screen.getByLabelText(/revenue per day/), { target: { value: "lots" } })
    expect(screen.getByText(/Type just the number/)).toBeTruthy()
  })
})

describe("reveal", () => {
  it("stays locked until both answers are written", () => {
    render(<SectionBlocks api={api({ "m1.restate": "Sales up, profit down" })} section={section("m1-welcome")} />)
    expect((screen.getByRole("button", { name: "Show the example answer" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/So the company is selling more than before/)).toBeNull()
  })

  it("opens once they have", () => {
    render(<SectionBlocks api={api({ "m1.restate": "a", "m1.question": "b" })} section={section("m1-welcome")} />)
    fireEvent.click(screen.getByRole("button", { name: "Show the example answer" }))
    expect(screen.getByText(/So the company is selling more than before/)).toBeTruthy()
  })
})

describe("video", () => {
  it("embeds the video and saves the tick as 1", () => {
    const set = vi.fn()
    const { container } = render(<SectionBlocks api={api({}, { set })} section={section("m2-first-video")} />)
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/lmQt9ak2jjA?rel=0")
    expect(screen.getByRole("link", { name: "Watch on YouTube" }).getAttribute("href")).toBe("https://www.youtube.com/watch?v=lmQt9ak2jjA")
    fireEvent.click(screen.getByLabelText("I watched this video"))
    expect(set).toHaveBeenCalledWith("m2.video", "1")
  })

  it("reads only YouTube links as embeds", () => {
    expect(youtubeEmbed("https://www.youtube.com/watch?v=cydnRA25gAw")).toContain("cydnRA25gAw")
    expect(youtubeEmbed("https://example.com/watch?v=cydnRA25gAw")).toBeNull()
  })
})

describe("sort", () => {
  it("compares only once every item has a group", () => {
    render(<SectionBlocks api={api({ "m5.sort.1": "Customer demand" })} section={section("m5-break-it-down")} />)
    expect((screen.getByRole("button", { name: "Compare with the sample" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("after comparing, says how each item matched", () => {
    const vals: Record<string, unknown> = { "m5.sort.checked": "1" }
    for (let i = 1; i <= 8; i++) vals[`m5.sort.${i}`] = "Competition"
    render(<SectionBlocks api={api(vals)} section={section("m5-break-it-down")} />)
    expect(screen.getByText("You matched our sample on 2 of 8.")).toBeTruthy()
    expect(screen.getAllByText(/Our sample puts this under/).length).toBe(6)
  })
})

describe("coach Results", () => {
  it("shows the first attempt beside the expected answer, and the Sunday summary", () => {
    render(<PracticeResults content={c} answers={{ "m4.pct": "50", "m2.video": "1", "m9.confused": "When to do math" }} />)
    expect(screen.getByText("Sunday prep summary")).toBeTruthy()
    expect(screen.getByText("50")).toBeTruthy()
    expect(screen.getAllByText("Missed").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Watched").length).toBe(1)
    expect(screen.getAllByText(/When to do math/).length).toBeGreaterThan(0)
  })
})
