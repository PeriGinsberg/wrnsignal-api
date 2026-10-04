// Settings > Services > Deliverables: each deliverable takes a Phase.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react"

vi.mock("../../../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))

import { DeliverablesTab } from "./DeliverablesTab"

const PHASES = [
  { id: "ph-know", label: "Know", active: true },
  { id: "ph-build", label: "Build", active: true },
  { id: "ph-old", label: "Retired", active: false },
]
const ITEM = {
  id: "m-1", name: "Resume rewrite", description: null, category: null, sort_order: 1, active: true,
  time_estimate_days: null, fee: null, activity_count: 0, phase_id: "ph-know",
  sow_bullets: "Full resume rebuild\nATS-friendly structure",
}
let sent: Array<{ url: string; method: string; body: any }>
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } })

beforeEach(() => {
  sent = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (method !== "GET") sent.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (url === "/api/coach/phases") return json({ ok: true, phases: PHASES })
    if (url === "/api/coach/milestones" && method === "GET") return json({ ok: true, milestones: [ITEM] })
    if (url === "/api/coach/milestones" && method === "POST") return json({ ok: true, milestone: { ...ITEM, id: "m-2" } }, 201)
    if (url.startsWith("/api/coach/milestones/")) {
      return json({ ok: true, milestone: { ...ITEM, phase_id: method === "PATCH" ? sent.at(-1)!.body.phase_id : ITEM.phase_id, activities: [] } })
    }
    return json({ ok: false }, 404)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("Deliverables: phase", () => {
  it("shows each deliverable's phase", async () => {
    render(<DeliverablesTab />)
    expect(await screen.findByText("Phase: Know")).toBeTruthy()
  })

  it("a new deliverable can be given a phase; switched-off phases are not offered", async () => {
    render(<DeliverablesTab />)
    await screen.findByText("Phase: Know")
    const select = screen.getByLabelText("Phase") as HTMLSelectElement
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["No phase", "Know", "Build"])
    fireEvent.change(screen.getByPlaceholderText("Name (required)"), { target: { value: "Mock interview" } })
    fireEvent.change(select, { target: { value: "ph-build" } })
    fireEvent.click(screen.getByRole("button", { name: "+ Add deliverable" }))
    await waitFor(() => expect(sent.some((c) => c.method === "POST")).toBe(true))
    expect(sent.find((c) => c.method === "POST")!.body).toMatchObject({ name: "Mock interview", phase_id: "ph-build" })
  })

  it("editing a deliverable changes its phase", async () => {
    render(<DeliverablesTab />)
    await screen.findByText("Phase: Know")
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    const select = screen.getAllByLabelText("Phase")[0] as HTMLSelectElement
    expect(select.value).toBe("ph-know")
    fireEvent.change(select, { target: { value: "" } })
    // Save waits until the deliverable's tasks have loaded into the form.
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)
    await waitFor(() => expect(sent.some((c) => c.method === "PATCH")).toBe(true))
    expect(sent.find((c) => c.method === "PATCH")!.body).toMatchObject({ phase_id: null })
  })
})

describe("Deliverables: SOW bullets", () => {
  it("shows how many SOW bullets a deliverable has", async () => {
    render(<DeliverablesTab />)
    expect(await screen.findByText("2 SOW bullets")).toBeTruthy()
  })

  it("a new deliverable is saved with its bullets", async () => {
    render(<DeliverablesTab />)
    await screen.findByText("Phase: Know")
    fireEvent.change(screen.getByPlaceholderText("Name (required)"), { target: { value: "Mock interview" } })
    fireEvent.change(screen.getByLabelText("SOW bullets"), { target: { value: "Recorded mock interview\nStructured scorecard" } })
    fireEvent.click(screen.getByRole("button", { name: "+ Add deliverable" }))
    await waitFor(() => expect(sent.some((c) => c.method === "POST")).toBe(true))
    expect(sent.find((c) => c.method === "POST")!.body).toMatchObject({ sow_bullets: "Recorded mock interview\nStructured scorecard" })
  })

  it("editing loads the bullets and saves changes", async () => {
    render(<DeliverablesTab />)
    await screen.findByText("Phase: Know")
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    const box = screen.getAllByLabelText("SOW bullets")[0] as HTMLTextAreaElement
    expect(box.value).toBe("Full resume rebuild\nATS-friendly structure")
    fireEvent.change(box, { target: { value: "" } })
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)
    await waitFor(() => expect(sent.some((c) => c.method === "PATCH")).toBe(true))
    expect(sent.find((c) => c.method === "PATCH")!.body).toMatchObject({ sow_bullets: null })
  })
})
