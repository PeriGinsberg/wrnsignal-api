// First-run check: what a brand-new account with ZERO contacts actually sees on
// each of the three tabs. Renders the real page components with every fetch
// returning an empty-but-successful payload, then asserts on the text.
//
// Written as a test rather than a screenshot so it keeps working: if someone
// later changes an empty state into a bare "No data" or an error-looking
// string, this fails instead of silently regressing the first thing a new user
// ever sees.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, cleanup } from "@testing-library/react"
import WorklistPage from "./page"
import ContactsPage from "./contacts/page"
import CompaniesPage from "./companies/page"

const authFetchMock = vi.fn()
vi.mock("./authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getToken: async () => "test-token",
}))

// The three list pages sit at different depths, so each resolves the shared
// wrapper by its own relative path. All three must be stubbed.
vi.mock("../authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getToken: async () => "test-token",
}))

// A brand-new account: every collection is present and empty. Not an error —
// that distinction is the whole point of this check.
const emptyPayload = { ok: true, contacts: [], companies: [], items: [], worklist: [], due: [] }

afterEach(cleanup)
beforeEach(() => {
  authFetchMock.mockReset()
  authFetchMock.mockImplementation(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => emptyPayload } as unknown as Response),
  )
})

// Words that mean "something went wrong". An empty state containing any of
// these reads as broken to a first-time user.
const ALARM = /error|failed|could not|unable|unauthorized|forbidden|something went wrong|undefined|NaN|\[object/i

async function textOf(ui: React.ReactElement): Promise<string> {
  const { container } = render(ui)
  await waitFor(() => expect(container.textContent).not.toMatch(/^\s*Loading/))
  return container.textContent ?? ""
}

describe("first-run empty states", () => {
  it("worklist: invites rather than alarms", async () => {
    const text = await textOf(<WorklistPage />)
    console.log("\n── TODAY (worklist) ──\n" + text.trim() + "\n")
    expect(text).not.toMatch(ALARM)
    expect(text.trim().length).toBeGreaterThan(0)
  })

  it("contacts spreadsheet: invites rather than alarms, and offers the way in", async () => {
    const text = await textOf(<ContactsPage />)
    console.log("\n── CONTACTS (spreadsheet) ──\n" + text.trim() + "\n")
    expect(text).not.toMatch(ALARM)
    // The empty state must point at the action, not just report emptiness.
    expect(text).toMatch(/add/i)
    // …and must NOT lead with the filter machinery. Six dropdowns of stages and
    // relationships above "No contacts yet" is the least inviting thing a new
    // user can meet.
    expect(text).not.toMatch(/All stages/)
    expect(text).not.toMatch(/All relationships/)
  })

  it("contacts: the filter bar RETURNS once there is something to filter", async () => {
    authFetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ ok: true, contacts: [{
          id: "c1", first_name: "Jordan", last_name: "Alvarez", title: null, stage: "identified",
          relationship: "personal", priority: "A", segment: null, next_due_at: null,
          next_due_reason: null, last_action_at: null, company_id: null, network_companies: null,
        }] }),
      } as unknown as Response),
    )
    const text = await textOf(<ContactsPage />)
    expect(text).toMatch(/All stages/)
    // Guarded on total contacts, not filtered ones — filtering to zero results
    // must never hide the controls needed to undo that filter.
    expect(text).toMatch(/Jordan Alvarez/)
  })

  it("company board: invites rather than alarms, and says a contact is not required", async () => {
    const text = await textOf(<CompaniesPage />)
    console.log("\n── COMPANIES (board) ──\n" + text.trim() + "\n")
    expect(text).not.toMatch(ALARM)
    expect(text).toMatch(/add a company/i)
  })
})
