// The Engagements tab: an Upcoming task in an approved package can be started
// here, in any order, and a due date on one offers to activate it.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react"

vi.mock("../../../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))

import { EngagementsTab } from "./EngagementsTab"

const act = (id: string, name: string, owner: string, state: string, sort_order: number) =>
  ({ id, name, owner, status: "not_started", state, due_date: null, is_signoff: false, sort_order })

function engagement(proposal_status: string) {
  return {
    id: "e1", name: "All the Way Through", proposal_status, is_proof_project: false, attached_at: "2026-10-04", discount: null,
    pricing: { subtotal: 0, unpriced_count: 0, effective_discount: 0, total: 0, discount_clamped: false },
    deliverables: [{
      id: "d-prep", name: "Pre-Interview Prep", category: null, time_estimate_days: null, fee: 150,
      speaking_point: null, why_this_matters: null, sort_order: 12,
      activities: [act("a1", "Prepare for pre-interview prep", "coach", "upcoming", 1), act("a2", "Book Offboarding session", "client", "upcoming", 2)],
    }],
  }
}

let calls: { url: string; method: string; body: any }[]
let status = "approved"
const json = (b: unknown, code = 200) => new Response(JSON.stringify(b), { status: code, headers: { "Content-Type": "application/json" } })

beforeEach(() => {
  calls = []
  status = "approved"
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (method !== "GET") calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (url.includes("/activities/") && method === "PATCH") return json({ ok: true, engagement: engagement(status) })
    if (url.endsWith("/plan")) return json({ ok: true })
    if (url.endsWith("/sow")) return json({ ok: true, sow: {
      status: "draft", saved: false, opening: null, price_override_cents: null, package_total_cents: 15000, total_cents: 15000,
      payment: { mode: "full" }, warnings: [],
      document: { client_name: "Aiden", practice_name: null, package_name: "x", opening: null, stages: [], sections: [], payment: { total_cents: 15000, mode: "full", payments: [] } },
    } })
    if (url === "/api/coach/milestones") return json({ ok: true, milestones: [{ id: "m-mock", name: "Mock Interview", active: true }, { id: "m-old", name: "Retired", active: false }] })
    return json({ ok: true, engagements: [engagement(status)] })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function open() {
  render(<EngagementsTab coachClientId="cc-1" clientName="Aiden" />)
  fireEvent.click(await screen.findByRole("button", { name: "View" }))
  return screen.findByText("Prepare for pre-interview prep")
}
const row = (name: string) => screen.getByText(name).parentElement as HTMLElement

describe("Engagements: starting a task", () => {
  it("offers Activate on a coach task and Release on a client task, through the Plan route", async () => {
    await open()
    fireEvent.click(within(row("Prepare for pre-interview prep")).getByRole("button", { name: "Activate" }))
    await waitFor(() => expect(calls).toHaveLength(1))
    fireEvent.click(within(row("Book Offboarding session")).getByRole("button", { name: "Release" }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls).toEqual([
      { url: "/api/coach/coach-clients/cc-1/plan", method: "POST", body: { action: "activate", task_id: "a1" } },
      { url: "/api/coach/coach-clients/cc-1/plan", method: "POST", body: { action: "release", task_id: "a2" } },
    ])
  })

  it("offers nothing until the package is approved", async () => {
    status = "sent"
    await open()
    expect(screen.queryByRole("button", { name: "Activate" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Release" })).toBeNull()
  })

  it("a due date on an Upcoming task asks to activate it; Yes activates, No only saves the date", async () => {
    await open()
    const date = () => within(row("Prepare for pre-interview prep")).getByLabelText("Activity due date")
    fireEvent.change(date(), { target: { value: "2026-10-04" } })
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Make this task active now?" })).getByRole("button", { name: "No" }))
    expect(calls.map((c) => c.method)).toEqual(["PATCH"])

    fireEvent.change(date(), { target: { value: "2026-10-05" } })
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes" }))
    await waitFor(() => expect(calls).toHaveLength(3))
    expect(calls[2].body).toEqual({ action: "activate", task_id: "a1" })
  })
})

describe("Engagements: customizing a proposal", () => {
  const plans = () => calls.filter((c) => c.url.endsWith("/plan")).map((c) => c.body)

  it("a draft package's deliverable can be marked Not needed or removed, with a confirm", async () => {
    status = "draft"
    await open()
    const block = screen.getByTestId("eng-deliverable")
    fireEvent.click(within(block).getByRole("button", { name: "Not needed" }))
    await waitFor(() => expect(plans()).toHaveLength(1))
    fireEvent.click(within(block).getByRole("button", { name: "Remove" }))
    expect(within(block).getByText(/Remove Pre-Interview Prep and its tasks/)).toBeTruthy()
    fireEvent.click(within(block).getAllByRole("button", { name: "Remove" })[0])
    await waitFor(() => expect(plans()).toHaveLength(2))
    expect(plans()).toEqual([
      { action: "deliverable_not_needed", deliverable_id: "d-prep" },
      { action: "remove_deliverable", deliverable_id: "d-prep" },
    ])
  })

  it("adds a deliverable from the library (active ones only)", async () => {
    status = "sent"
    await open()
    const pick = await screen.findByLabelText("Deliverable to add") as HTMLSelectElement
    expect(within(pick).getAllByRole("option").map((o) => o.textContent)).toEqual(["Add a deliverable from your library…", "Mock Interview"])
    fireEvent.change(pick, { target: { value: "m-mock" } })
    fireEvent.click(screen.getByRole("button", { name: "+ Add deliverable" }))
    await waitFor(() => expect(plans()).toEqual([{ action: "add_deliverable", engagement_id: "e1", milestone_id: "m-mock" }]))
  })

  it("a proposal shows its SOW panel; an approved package has neither", async () => {
    status = "draft"
    await open()
    expect(screen.getByTestId("sow-panel")).toBeTruthy()
    cleanup()
    status = "approved"
    await open()
    expect(screen.queryByTestId("sow-panel")).toBeNull()
    expect(screen.queryByRole("button", { name: "Not needed" })).toBeNull()
    expect(screen.queryByLabelText("Deliverable to add")).toBeNull()
  })
})
