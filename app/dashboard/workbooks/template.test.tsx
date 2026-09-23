// The session-template rendering, against the real template file.
//
// Pinned: the mode tag, the coach guide's title (and that it never reaches the
// client), a big_quote written as `body`, a summary with no interview, and the
// homework button: where it appears, that it posts once, and what it shows
// afterwards.

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SectionBlocks, SectionHeader, type FieldApi } from "../../../components/workbook/Blocks"
import { HomeworkComplete } from "../../../components/workbook/HomeworkComplete"
import { Summary } from "../../../components/workbook/Summary"
import { applyTemplate, lastHomeworkSectionId, validateContent, type WorkbookContent } from "../../../lib/workbook/content"
import { getTemplate } from "../../../lib/workbook/templates"
import { wbFetch } from "../../../components/workbook/api"

// The page's authenticated fetch needs a Supabase session; the button's contract
// is what it sends and what it does with the answer, so the transport is mocked.
vi.mock("../../../components/workbook/api", () => ({ wbFetch: vi.fn(), getToken: vi.fn() }))
const mockFetch = vi.mocked(wbFetch)

afterEach(cleanup)

// The registry, not the file: templates are code now, and this is the copy the
// create route fills in.
const raw = getTemplate("session-1-foundations")!.content
const parsed = validateContent(applyTemplate(raw, { first_name: "Alex", full_name: "Alex Rivera", coach_first_name: "Peri" }))
if (!parsed.ok) throw new Error(parsed.errors.join("; "))
const t: WorkbookContent = parsed.content
const section = (id: string) => t.sections.find((s) => s.id === id)!

function api(over: Partial<FieldApi> = {}): FieldApi {
  return {
    editable: true,
    // undefined = never answered, which is what lets starter text show. An
    // empty string means the client cleared the box, and is not the same thing.
    get: () => undefined,
    set: vi.fn(),
    state: () => undefined,
    coachName: "Peri",
    showCoachOnly: false,
    ...over,
  }
}

describe("session template rendering", () => {
  it("labels an in-session section", () => {
    render(<SectionHeader section={section("welcome")} total={t.sections.length} />)
    expect(screen.getByText("In session")).toBeTruthy()
  })

  it("labels a homework section", () => {
    render(<SectionHeader section={section("homework")} total={t.sections.length} />)
    expect(screen.getByText("Homework")).toBeTruthy()
  })

  it("renders a big_quote written as body", () => {
    render(<SectionBlocks api={api()} section={section("tmay")} />)
    expect(screen.getByText(/my name is Kaitlyn Yardly/)).toBeTruthy()
  })

  it("keeps the coach guide away from the client", () => {
    render(<SectionBlocks api={api()} section={section("welcome")} />)
    expect(screen.queryByText(/HOUSE RULE/)).toBeNull()
    expect(screen.queryByText(/Coach guide/)).toBeNull()
  })

  it("shows the coach guide with its title in the coach view", () => {
    render(<SectionBlocks api={api({ showCoachOnly: true })} section={section("welcome")} />)
    expect(screen.getByText(/Coach guide: Welcome/)).toBeTruthy()
    expect(screen.getByText(/HOUSE RULE/)).toBeTruthy()
  })

  it("renders the filled hook prefix", () => {
    render(<SectionBlocks api={api({ get: (k) => (k === "hook.final" ? "has been to Antarctica" : "") })} section={section("hook")} />)
    expect(screen.getByText(/Oh yeah, Alex\. The one who has been to Antarctica\./)).toBeTruthy()
  })

  it("renders a summary that has no interview", () => {
    render(<Summary content={t} answers={{ "hw.strength1": "Organised" }} interview={null} />)
    expect(screen.getByText("Organised")).toBeTruthy()
    expect(screen.queryByText("When")).toBeNull()
  })
})

describe("HomeworkComplete", () => {
  const post = (status: number, body: object) => mockFetch.mockResolvedValue({ status, body } as never)

  it("belongs to the last homework section", () => {
    expect(lastHomeworkSectionId(t)).toBe("finish")
  })

  it("posts once and reports completion", async () => {
    const onDone = vi.fn()
    post(200, { ok: true, completed_at: "2026-09-23T10:00:00Z", first_time: true, webhook: "sent" })
    render(<HomeworkComplete workbookId="w1" completedAt={null} coachName="Peri" onDone={onDone} />)
    fireEvent.click(screen.getByRole("button", { name: "Mark homework complete" }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("2026-09-23T10:00:00Z"))
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toBe("/api/me/workbooks/w1/homework-complete")
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: "POST" })
  })

  it("shows the date instead of the button once complete", () => {
    render(<HomeworkComplete workbookId="w1" completedAt="2026-09-23T10:00:00Z" coachName="Peri" onDone={vi.fn()} />)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText(/Homework marked complete/)).toBeTruthy()
  })

  it("keeps the button on a failure and says so", async () => {
    post(500, { ok: false, error: "Couldn't mark it complete. Try again." })
    const onDone = vi.fn()
    render(<HomeworkComplete workbookId="w1" completedAt={null} coachName="Peri" onDone={onDone} />)
    fireEvent.click(screen.getByRole("button", { name: "Mark homework complete" }))
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Mark homework complete" })).toBeTruthy()
  })
})

describe("starter text (Harry's recruiter-call workbook)", () => {
  const hRaw = JSON.parse(readFileSync(
    join(__dirname, "../../../docs/workbooks-v1/workbooks-v1/harry_recruiter-call-lease-coordinator.json"), "utf8"))
  const hParsed = validateContent(hRaw)
  if (!hParsed.ok) throw new Error(hParsed.errors.join("; "))
  const h: WorkbookContent = hParsed.content
  const hSection = (id: string) => h.sections.find((s) => s.id === id)!

  it("pre-seeds the box and says it is a starting point", () => {
    render(<SectionBlocks api={api()} section={hSection("intro")} />)
    expect((screen.getByLabelText("My Present") as HTMLTextAreaElement).value).toMatch(/I'm \[where you are right now/)
    expect(screen.getAllByText("A starting point. Edit it into your own words.").length).toBe(3)
  })

  it("shows the client's own answer instead, once saved", () => {
    render(<SectionBlocks api={api({ get: (k) => (k === "intro.present" ? "I'm a senior at UF" : undefined) })}
      section={hSection("intro")} />)
    expect((screen.getByLabelText("My Present") as HTMLTextAreaElement).value).toBe("I'm a senior at UF")
  })

  it("does not restore the starter after the client clears it", () => {
    render(<SectionBlocks api={api({ get: (k) => (k === "intro.past" ? "" : undefined) })} section={hSection("intro")} />)
    expect((screen.getByLabelText("My Past") as HTMLTextAreaElement).value).toBe("")
  })

  it("keeps the coach notes away from the client", () => {
    render(<SectionBlocks api={api()} section={hSection("questions")} />)
    expect(screen.queryByText(/Let him find it|reuse it in later rounds/)).toBeNull()
    expect((screen.getByLabelText(/My questions/) as HTMLTextAreaElement).value).toMatch(/What specifically about my background/)
  })

  it("shows the coach notes to the coach", () => {
    render(<SectionBlocks api={api({ showCoachOnly: true })} section={hSection("questions")} />)
    expect(screen.getByText(/reuse it in later rounds/)).toBeTruthy()
  })

  it("leaves an untouched starter out of the summary", () => {
    render(<Summary content={h} answers={{}} interview={null} />)
    expect(screen.getAllByText("Not filled in yet").length).toBeGreaterThan(0)
    expect(screen.queryByText(/What specifically about my background/)).toBeNull()
  })
})
