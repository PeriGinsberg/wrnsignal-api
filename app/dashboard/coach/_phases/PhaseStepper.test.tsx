// The Phase stepper on a client record.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react"

vi.mock("../../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))

import { PhaseStepper } from "./PhaseStepper"

type P = { phase_id: string; label: string; status: string; tasks_done: number; tasks_total: number; ready_to_complete: boolean; updated_at: null }
const phase = (label: string, status: string, done = 0, total = 0, ready = false): P =>
  ({ phase_id: `ph-${label.toLowerCase()}`, label, status, tasks_done: done, tasks_total: total, ready_to_complete: ready, updated_at: null })

let current: P[]
let patches: Array<{ url: string; body: any }>
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } })

beforeEach(() => {
  current = [
    phase("Know", "complete", 3, 3),
    phase("Build", "in_progress", 1, 4),
    phase("Prove", "not_started", 2, 2, true),
    phase("Search", "not_in_plan"),
    phase("Land", "not_in_plan"),
  ]
  patches = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body))
      patches.push({ url, body })
      const id = url.split("/").pop()
      current = current.map((p) => (p.phase_id === id ? { ...p, status: body.status } : p))
      return json({ ok: true, changed: true, phases: current })
    }
    if (url === "/api/coach/coach-clients/cc-1/phases") return json({ ok: true, phases: current })
    return json({ ok: false }, 404)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("Phase stepper", () => {
  it("is headed Phase, not Engagement Methodology", async () => {
    render(<PhaseStepper coachClientId="cc-1" />)
    expect(await screen.findByText("PHASE")).toBeTruthy()
    expect(screen.queryByText(/methodology/i)).toBeNull()
  })

  it("shows every phase with its status and tasks done / total", async () => {
    render(<PhaseStepper coachClientId="cc-1" />)
    expect(await screen.findByRole("button", { name: "Know: Complete" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Build: In progress" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Prove: Not started" })).toBeTruthy()
    expect(screen.getByText("1 / 4 tasks")).toBeTruthy()
    expect(screen.getByText("3 / 3 tasks")).toBeTruthy()
  })

  it("uses the agreed colours", async () => {
    render(<PhaseStepper coachClientId="cc-1" />)
    const circle = (name: string) => (screen.getByRole("button", { name }).firstElementChild as HTMLElement).style
    await screen.findByRole("button", { name: "Know: Complete" })
    expect(circle("Know: Complete").backgroundColor).toBe("rgb(0, 179, 179)")
    expect(circle("Build: In progress").backgroundColor).toBe("rgb(0, 155, 255)")
    expect(circle("Prove: Not started").borderColor).toBe("rgb(8, 32, 63)")
    expect(circle("Prove: Not started").backgroundColor).toBe("rgb(255, 255, 255)")
  })

  it("dims Not in plan phases and does not let them be set", async () => {
    render(<PhaseStepper coachClientId="cc-1" />)
    const search = await screen.findByRole("button", { name: "Search: Not in plan" }) as HTMLButtonElement
    expect(search.disabled).toBe(true)
    expect(search.style.opacity).toBe("0.5")
    expect(within(search).queryByText(/tasks/)).toBeNull()
  })

  it("says when every task in a phase is done", async () => {
    render(<PhaseStepper coachClientId="cc-1" />)
    const note = await screen.findByRole("status")
    expect(note.textContent).toBe("Prove: All tasks done, ready to mark complete.")
  })

  it("sets a phase forward without asking", async () => {
    render(<PhaseStepper coachClientId="cc-1" />)
    fireEvent.click(await screen.findByRole("button", { name: "Prove: Not started" }))
    const dialog = screen.getByRole("dialog", { name: "Prove phase" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Complete" }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toEqual({ url: "/api/coach/coach-clients/cc-1/phases/ph-prove", body: { status: "complete" } })
    expect(await screen.findByRole("button", { name: "Prove: Complete" })).toBeTruthy()
  })

  it("asks before moving a phase back", async () => {
    render(<PhaseStepper coachClientId="cc-1" />)
    fireEvent.click(await screen.findByRole("button", { name: "Know: Complete" }))
    fireEvent.click(within(screen.getByRole("dialog", { name: "Know phase" })).getByRole("button", { name: "In progress" }))
    const confirm = screen.getByRole("dialog", { name: "Move phase back" })
    expect(confirm.textContent).toContain("Move Know back from Complete to In progress?")
    expect(patches).toHaveLength(0)
    fireEvent.click(within(confirm).getByRole("button", { name: "Move back" }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0].body).toEqual({ status: "in_progress" })
  })

  it("cancelling a move back changes nothing", async () => {
    render(<PhaseStepper coachClientId="cc-1" />)
    fireEvent.click(await screen.findByRole("button", { name: "Build: In progress" }))
    fireEvent.click(within(screen.getByRole("dialog", { name: "Build phase" })).getByRole("button", { name: "Not started" }))
    fireEvent.click(within(screen.getByRole("dialog", { name: "Move phase back" })).getByRole("button", { name: "Cancel" }))
    expect(patches).toHaveLength(0)
    expect(screen.getByRole("button", { name: "Build: In progress" })).toBeTruthy()
  })
})
