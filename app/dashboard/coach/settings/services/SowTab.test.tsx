// Settings > Services > SOW: the practice's standard SOW sections.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react"

vi.mock("../../../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/coach/settings/services",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=sow"),
}))

import { SowTab } from "./SowTab"
import { ServicesTabs } from "./ServicesTabs"

const PHASES = ["Know", "Build", "Prove", "Search", "Land"].map((label, i) => ({
  id: `ph-${label.toLowerCase()}`, phase_key: label.toLowerCase(), label, sort_order: i + 1, active: label !== "Prove", is_custom: false,
  sow_subtitle: null, sow_note: null,
}))
const LINES = [
  { id: "l1", section: "included", body: "SIGNAL, including application tracking", show_for: "every_plan", phase_id: null, sort_order: 1 },
  { id: "l2", section: "included", body: "Ultimate Interview Playbook", show_for: "phase_not_in_plan", phase_id: "ph-land", sort_order: 2 },
  { id: "l3", section: "not_included", body: "No guarantee of job placement", show_for: "every_plan", phase_id: null, sort_order: 1 },
]
let puts: any[]
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } })

beforeEach(() => {
  puts = []
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body))
      puts.push(body)
      return json({ ok: true, lines: body.lines.map((l: any, i: number) => ({ id: `n${i}`, sort_order: i + 1, ...l })) })
    }
    return json({ ok: true, lines: LINES, phases: PHASES })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const section = (key: string) => screen.getByTestId(`sow-section-${key}`)

describe("SOW settings", () => {
  it("is a tab under Services", async () => {
    render(<ServicesTabs />)
    expect(screen.getByRole("button", { name: "SOW" })).toBeTruthy()
    await screen.findByDisplayValue("No guarantee of job placement")
  })

  it("shows the four sections with their lines and Show for", async () => {
    render(<SowTab />)
    await screen.findByDisplayValue("Ultimate Interview Playbook")
    expect(within(section("included")).getAllByTestId("sow-line")).toHaveLength(2)
    expect(within(section("optional")).getByText("No lines yet.")).toBeTruthy()
    expect(within(section("how_we_work")).getByText("No lines yet.")).toBeTruthy()
    const show = screen.getByLabelText("Show for, Included at no charge line 2") as HTMLSelectElement
    expect(show.value).toBe("out:ph-land")
    expect(show.selectedOptions[0].textContent).toBe("Only when Land is NOT in the plan")
  })

  it("offers every plan, in-plan and not-in-plan for active phases only", async () => {
    render(<SowTab />)
    await screen.findByDisplayValue("Ultimate Interview Playbook")
    const labels = within(screen.getByLabelText("Show for, Included at no charge line 1") as HTMLElement)
      .getAllByRole("option").map((o) => o.textContent)
    expect(labels[0]).toBe("Every plan")
    expect(labels).toContain("Only when Know is in the plan")
    expect(labels).toContain("Only when Land is NOT in the plan")
    expect(labels.some((l) => l?.includes("Prove"))).toBe(false)
  })

  it("adds, ties to a phase, reorders and saves the whole set", async () => {
    render(<SowTab />)
    await screen.findByDisplayValue("Ultimate Interview Playbook")
    fireEvent.click(within(section("how_we_work")).getByRole("button", { name: "+ Add line" }))
    fireEvent.change(screen.getByLabelText("How we work line 1"), { target: { value: "Mock interviews are recorded" } })
    fireEvent.change(screen.getByLabelText("Show for, How we work line 1"), { target: { value: "in:ph-land" } })
    fireEvent.click(within(section("included")).getAllByRole("button", { name: "Move line up" })[1])
    fireEvent.click(screen.getByRole("button", { name: "Save SOW sections" }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].lines).toEqual([
      { section: "included", body: "Ultimate Interview Playbook", show_for: "phase_not_in_plan", phase_id: "ph-land" },
      { section: "included", body: "SIGNAL, including application tracking", show_for: "every_plan", phase_id: null },
      { section: "not_included", body: "No guarantee of job placement", show_for: "every_plan", phase_id: null },
      { section: "how_we_work", body: "Mock interviews are recorded", show_for: "phase_in_plan", phase_id: "ph-land" },
    ])
    expect(await screen.findByText("SOW sections saved.")).toBeTruthy()
  })

  it("edits and saves the default opening paragraph with the lines", async () => {
    render(<SowTab />)
    await screen.findByDisplayValue("Ultimate Interview Playbook")
    const box = screen.getByLabelText("Default opening paragraph") as HTMLTextAreaElement
    expect(box.value).toBe("")
    fireEvent.change(box, { target: { value: "Hi [First Name],\n\nThank you." } })
    fireEvent.click(screen.getByRole("button", { name: "Save SOW sections" }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].default_opening).toBe("Hi [First Name],\n\nThank you.")
    expect(puts[0].lines).toHaveLength(3)
  })

  it("won't save an empty line, and removes lines", async () => {
    render(<SowTab />)
    await screen.findByDisplayValue("Ultimate Interview Playbook")
    fireEvent.click(within(section("optional")).getByRole("button", { name: "+ Add line" }))
    fireEvent.click(screen.getByRole("button", { name: "Save SOW sections" }))
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(puts).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "Remove Optional addition line 1" }))
    fireEvent.click(screen.getByRole("button", { name: "Remove Not included line 1" }))
    fireEvent.click(screen.getByRole("button", { name: "Save SOW sections" }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].lines.map((l: any) => l.body)).toEqual(["SIGNAL, including application tracking", "Ultimate Interview Playbook"])
  })
})
