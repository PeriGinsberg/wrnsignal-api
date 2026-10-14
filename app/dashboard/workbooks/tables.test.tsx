// Tables and grids, against the table version of Aiden Ginsberg's Bond Sports
// Round 2 workbook. A fixture copy, because the version created in prod uses
// text notes and Lead boxes in place of the tables and grid (a123d8c3).
//
// Pinned: every lead cell is a box the client can type in and saves under its
// own key; read-only tables, starters and notes are text, not inputs; and the
// coach's "See it as" preview locks every box.

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SectionBlocks, type FieldApi } from "../../../components/workbook/Blocks"
import { validateContent, type WorkbookContent } from "../../../lib/workbook/content"

const raw = JSON.parse(readFileSync(join(__dirname, "__fixtures__/bond-sports-round-2-tables.json"), "utf8"))
const parsed = validateContent(raw)
if (!parsed.ok) throw new Error(parsed.errors.join("; "))
const c: WorkbookContent = parsed.content
const section = (id: string) => c.sections.find((s) => s.id === id)!

function api(over: Partial<FieldApi> = {}): FieldApi {
  return {
    editable: true,
    get: () => undefined,
    all: () => ({}),
    set: vi.fn(),
    state: () => undefined,
    coachName: "Peri",
    showCoachOnly: false,
    ...over,
  }
}

afterEach(cleanup)

describe("the leads grid", () => {
  it("is ten rows of six boxes the client can type in, plus three answer boxes", () => {
    const { container } = render(<SectionBlocks api={api()} section={section("today-s-homework")} />)
    const cells = container.querySelectorAll("input.wb-cell")
    expect(cells).toHaveLength(60)
    expect([...cells].every((el) => !(el as HTMLInputElement).readOnly)).toBe(true)
    expect(container.querySelectorAll("textarea")).toHaveLength(3)
  })

  it("saves a cell under its own row and column", () => {
    const set = vi.fn()
    render(<SectionBlocks api={api({ set })} section={section("today-s-homework")} />)
    fireEvent.change(screen.getByLabelText("Owner or GM 4"), { target: { value: "Jane Doe, GM" } })
    expect(set).toHaveBeenCalledWith("leads.4.owner-or-gm", "Jane Doe, GM")
  })

  it("shows the guide row and the opener as text, not boxes", () => {
    render(<SectionBlocks api={api()} section={section("today-s-homework")} />)
    expect(screen.getByText("Online, phone, or a basic form").tagName).toBe("TD")
    expect(screen.getByText("Your opener")).toBeTruthy()
    expect(screen.getByText(/Hi, my name's Aiden/).tagName).toBe("P")
  })

  it("is locked in the coach's preview", () => {
    const { container } = render(<SectionBlocks api={api({ editable: false })} section={section("today-s-homework")} />)
    const boxes = container.querySelectorAll("input, textarea")
    expect([...boxes].every((el) => (el as HTMLInputElement).readOnly)).toBe(true)
  })
})

describe("read-only tables", () => {
  it("shows the competitors with their header row", () => {
    render(<SectionBlocks api={api()} section={section("why-bond-wins")} />)
    expect(screen.getByRole("columnheader", { name: "Built for" })).toBeTruthy()
    expect(screen.getByText("SportsEngine (NBC)")).toBeTruthy()
  })

  it("shows the SaaS words with no inputs but the one notes box", () => {
    const { container } = render(<SectionBlocks api={api()} section={section("saas-words")} />)
    expect(screen.getByText("Churn")).toBeTruthy()
    expect(screen.getByText("Customers who cancel. Low churn means people stay.")).toBeTruthy()
    expect(container.querySelectorAll("input, textarea")).toHaveLength(1)
  })
})
