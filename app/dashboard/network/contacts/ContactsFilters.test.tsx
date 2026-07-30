// Deep-link integration test: landing on Contacts with a filter in the URL must
// actually filter, and must keep working when only the QUERY STRING changes —
// which is what a client navigation from the dashboard does.
//
// This is the gap the funnel-href test left. That one proved the link points at
// ?phase=momentum; it said nothing about whether arriving there filters
// anything. A correct href into a page that ignores it is still a broken
// feature.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react"
import ContactsPage from "./page"

// Swapped between renders to simulate the URL changing under the component.
let params = new URLSearchParams()
const replaceMock = vi.fn()

vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dashboard/network/contacts",
}))

const authFetchMock = vi.fn()
vi.mock("../authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getToken: async () => "test-token",
}))

let seq = 0
function c(over: Record<string, unknown> = {}) {
  seq++
  return {
    id: `c${seq}`, first_name: "P", last_name: `Q${seq}`, title: null, stage: "identified",
    relationship: "cold", priority: "B", segment: "Seg A", next_due_at: null, next_due_reason: null,
    last_action_at: null, company_id: null, network_companies: null,
    first_touch_at: null, first_replied_at: null, first_chat_at: null, outcome_type: null,
    ...over,
  }
}

// One contact per phase group plus extras, so every filter has both a match and
// a non-match to discriminate.
const ROSTER = [
  c({ first_name: "Ida", stage: "identified" }),                                   // idle
  c({ first_name: "Ivan", stage: "identified", relationship: null }),              // idle, no relationship
  c({ first_name: "Amy", stage: "sequence_active" }),                              // active
  c({ first_name: "Alan", stage: "intro_requested" }),                             // active
  c({ first_name: "Rita", stage: "replied" }),                                     // alive
  c({ first_name: "Mo", stage: "chat_done" }),                                     // momentum
  c({ first_name: "Dara", stage: "dormant_declined" }),                            // resting
  c({ first_name: "Stan", stage: "sequence_active",                                 // stalled: 20d idle
      last_action_at: new Date(Date.now() - 20 * 86400000).toISOString() }),
]

// Row-objects, not table rows: the spreadsheet moved to the light theme.
const names = () =>
  Array.from(document.querySelectorAll('[data-testid^="row-"]')).map((r) => r.textContent ?? "")
const shows = (n: string) => names().some((t) => t.includes(n))

afterEach(cleanup)
beforeEach(() => {
  params = new URLSearchParams()
  authFetchMock.mockReset()
  authFetchMock.mockImplementation(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, contacts: ROSTER }) } as unknown as Response),
  )
})

async function renderWith(qs: string) {
  params = new URLSearchParams(qs)
  const utils = render(<ContactsPage />)
  await waitFor(() => expect(names().length).toBeGreaterThan(0))
  return utils
}

describe("deep-link filters apply on arrival", () => {
  it("?phase= filters to the whole group, not one stage", async () => {
    await renderWith("phase=active")
    // active === intro_requested + sequence_active, so BOTH must survive…
    expect(shows("Amy")).toBe(true)
    expect(shows("Alan")).toBe(true)
    // …and nothing from another group.
    expect(shows("Ida")).toBe(false)
    expect(shows("Mo")).toBe(false)
  })

  it("?status=stalled filters to the stalled contact only", async () => {
    await renderWith("status=stalled")
    expect(shows("Stan")).toBe(true)
    expect(shows("Amy")).toBe(false)   // sequence_active but recently touched
  })

  it("?relationship=__none__ filters to contacts with no relationship", async () => {
    await renderWith("relationship=__none__")
    expect(shows("Ivan")).toBe(true)
    expect(shows("Ida")).toBe(false)
  })

  it("the pre-existing params still work — ?stage= and ?segment=", async () => {
    await renderWith("stage=replied")
    expect(shows("Rita")).toBe(true)
    expect(shows("Ida")).toBe(false)
    cleanup()
    await renderWith("segment=Seg%20A")
    expect(shows("Ida")).toBe(true)
  })
})

describe("the dropdowns write to the URL", () => {
  it("changing a filter replaces the URL rather than holding private state", async () => {
    // The other half of making the URL the source of truth: if the controls kept
    // their own copy we would be back to two states that can disagree.
    await renderWith("")
    replaceMock.mockClear()
    const stage = screen.getAllByRole("combobox")[0]
    fireEvent.change(stage, { target: { value: "replied" } })
    expect(replaceMock).toHaveBeenCalledTimes(1)
    expect(String(replaceMock.mock.calls[0][0])).toContain("stage=replied")
  })
})

describe("filters react to the URL CHANGING, not just to mount", () => {
  it("re-filters when only the query string changes — the client-navigation case", async () => {
    // Arrive unfiltered, as if already sitting on Contacts.
    const { rerender } = await renderWith("")
    expect(shows("Ida")).toBe(true)
    expect(shows("Mo")).toBe(true)

    // The dashboard's funnel link fires: same route, new query string, NO remount.
    params = new URLSearchParams("phase=momentum")
    rerender(<ContactsPage />)

    await waitFor(() => expect(shows("Mo")).toBe(true))
    expect(shows("Ida")).toBe(false)
    expect(shows("Amy")).toBe(false)
  })

  it("re-filters again when the query string changes a second time", async () => {
    // Covers back/forward and clicking a second needs-attention row while already
    // on a filtered view.
    const { rerender } = await renderWith("phase=momentum")
    expect(shows("Mo")).toBe(true)

    params = new URLSearchParams("phase=resting")
    rerender(<ContactsPage />)
    await waitFor(() => expect(shows("Dara")).toBe(true))
    expect(shows("Mo")).toBe(false)
  })

  it("clearing the query string returns to the full list", async () => {
    const { rerender } = await renderWith("phase=momentum")
    expect(shows("Ida")).toBe(false)

    params = new URLSearchParams("")
    rerender(<ContactsPage />)
    await waitFor(() => expect(shows("Ida")).toBe(true))
    expect(shows("Mo")).toBe(true)
  })
})
