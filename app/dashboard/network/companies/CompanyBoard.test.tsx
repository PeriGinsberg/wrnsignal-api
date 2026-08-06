// Component tests for the company board's two behaviours that are pure client
// state and therefore invisible to route-level testing:
//
//   1. the delete guard rail — does type-to-confirm ACTUALLY block, or is it
//      decorative? A disabled-looking button that still fires on click is the
//      exact failure mode a visual check misses.
//   2. lazy-load fetch-once — does re-expanding refetch? A per-render fetch is
//      invisible in the UI and only shows up as load on the API.
//
// Same pattern as ContactRow.test.tsx: render in isolation, fire real events,
// assert what the DOM does next.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { DeleteCompanyConfirm } from "./DeleteCompanyConfirm"
import { CompanyCard, type Company } from "./CompanyCard"

const authFetchMock = vi.fn()
vi.mock("../authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getToken: async () => "test-token",
}))

const company: Company = {
  id: "co1",
  name: "Nodal Exchange",
  domain: "nodalexchange.com",
  tier: "dream",
  status: "researching",
  notes: null,
  contact_count: 4,
}

afterEach(cleanup)

describe("DeleteCompanyConfirm — guard rail scaled to what is lost", () => {
  it("BLOCKS deletion until the typed name matches, for a company with contacts", () => {
    const onConfirm = vi.fn()
    render(<DeleteCompanyConfirm name="Nodal Exchange" contactCount={4} busy={false} onCancel={() => {}} onConfirm={onConfirm} />)

    // The promise made to the user, verbatim.
    expect(
      screen.getByText(/Removing this company keeps its 4 contacts as standalone, not deleted\./),
    ).toBeTruthy()

    const button = screen.getByRole("button", { name: /Remove company/i }) as HTMLButtonElement
    const field = screen.getByLabelText("Type the company name to confirm")

    // Nothing typed → blocked.
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onConfirm).not.toHaveBeenCalled()

    // A PARTIAL match must not unlock it — the near-miss is the dangerous case.
    fireEvent.change(field, { target: { value: "Nodal" } })
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onConfirm).not.toHaveBeenCalled()

    // Wrong name entirely → still blocked.
    fireEvent.change(field, { target: { value: "Nodal Exchange LLC" } })
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onConfirm).not.toHaveBeenCalled()

    // Exact match (case-insensitive, trimmed) → unlocked, and the click lands.
    fireEvent.change(field, { target: { value: "  nodal exchange  " } })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("does NOT require typing for an empty company — friction is proportionate", () => {
    const onConfirm = vi.fn()
    render(<DeleteCompanyConfirm name="Empty Co" contactCount={0} busy={false} onCancel={() => {}} onConfirm={onConfirm} />)

    expect(screen.queryByLabelText("Type the company name to confirm")).toBeNull()
    expect(screen.queryByText(/keeps its/)).toBeNull()

    const button = screen.getByRole("button", { name: /Remove company/i }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("uses singular wording for exactly one contact", () => {
    render(<DeleteCompanyConfirm name="Solo Co" contactCount={1} busy={false} onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.getByText(/keeps its 1 contact as standalone, not deleted\./)).toBeTruthy()
  })
})

/** Calls to one endpoint, so "fetched once" keeps meaning what it did. */
const callsTo = (prefix: string) =>
  authFetchMock.mock.calls.filter((c) => String(c[0]).startsWith(prefix)).length

describe("CompanyCard — lazy load", () => {
  beforeEach(() => {
    authFetchMock.mockReset()
    // Routed by URL: expanding now makes TWO independent reads, the roster and
    // the applications at this company. Counting raw calls would say nothing
    // about whether either one refetched, so the assertions below count each
    // endpoint separately.
    authFetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          String(url).startsWith("/api/applications")
            ? { ok: true, applications: [] }
            : {
                ok: true,
                contacts: [
                  { id: "p1", first_name: "Jordan", last_name: "Alvarez", title: "Analyst", stage: "replied" },
                ],
              },
      } as unknown as Response),
    )
  })

  it("expands when the ROW is clicked, not just the chevron, and fetches once", async () => {
    // The gap the other tests missed: they all reach for the chevron by its
    // aria-label, so they pass even when every other pixel of the row is inert.
    // A user clicks the company NAME. That has to work.
    render(<CompanyCard company={company} onChanged={() => {}} onRequestDelete={() => {}} />)

    fireEvent.click(screen.getByText("Nodal Exchange"))

    await waitFor(() => expect(screen.getByText("Jordan Alvarez")).toBeTruthy())
    expect(callsTo("/api/network/contacts")).toBe(1)
    expect(authFetchMock.mock.calls[0][0]).toBe("/api/network/contacts?company_id=co1")
    // The applications ride the SAME pass rather than fetching on mount.
    expect(callsTo("/api/applications")).toBe(1)
  })

  it("fetches contacts on first expand only — collapse and re-expand do not refetch", async () => {
    render(<CompanyCard company={company} onChanged={() => {}} onRequestDelete={() => {}} />)

    // Nothing fetched until opened.
    expect(authFetchMock).not.toHaveBeenCalled()

    const toggle = screen.getByLabelText(/Expand Nodal Exchange/)
    fireEvent.click(toggle)

    await waitFor(() => expect(screen.getByText("Jordan Alvarez")).toBeTruthy())
    expect(callsTo("/api/network/contacts")).toBe(1)
    expect(authFetchMock.mock.calls[0][0]).toBe("/api/network/contacts?company_id=co1")

    // Collapse, then re-expand: the row is still there and NO second request,
    // for EITHER endpoint.
    fireEvent.click(screen.getByLabelText(/Collapse Nodal Exchange/))
    fireEvent.click(screen.getByLabelText(/Expand Nodal Exchange/))
    await waitFor(() => expect(screen.getByText("Jordan Alvarez")).toBeTruthy())
    expect(callsTo("/api/network/contacts")).toBe(1)
    expect(callsTo("/api/applications")).toBe(1)
  })

  it("does not refetch a genuinely empty company on re-expand", async () => {
    authFetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ ok: true, contacts: [], applications: [] }),
      } as unknown as Response),
    )
    render(<CompanyCard company={{ ...company, contact_count: 0 }} onChanged={() => {}} onRequestDelete={() => {}} />)

    fireEvent.click(screen.getByLabelText(/Expand Nodal Exchange/))
    await waitFor(() => expect(screen.getByText(/No contacts here yet/)).toBeTruthy())
    expect(callsTo("/api/network/contacts")).toBe(1)

    // `loaded` is tracked separately from contacts.length, so zero contacts must
    // not look like "never loaded" and trigger a refetch loop.
    fireEvent.click(screen.getByLabelText(/Collapse Nodal Exchange/))
    fireEvent.click(screen.getByLabelText(/Expand Nodal Exchange/))
    await waitFor(() => expect(screen.getByText(/No contacts here yet/)).toBeTruthy())
    expect(callsTo("/api/network/contacts")).toBe(1)
  })
})

describe("CompanyCard — applications at this company", () => {
  const withApps = (applications: unknown[], contactsOk = true) => (url: string) =>
    Promise.resolve({
      ok: contactsOk || String(url).startsWith("/api/applications"),
      status: 200,
      json: async () =>
        String(url).startsWith("/api/applications")
          ? { ok: true, applications }
          : { ok: true, contacts: [{ id: "p1", first_name: "Jordan", last_name: "Alvarez", title: "Analyst", stage: "replied" }] },
    } as unknown as Response)

  const APP_ROWS = [
    { id: "a1", company_name: "Nodal Exchange", job_title: "Operations Analyst", application_status: "applied", applied_date: "2026-08-12", signal_score: 71, signal_decision: "Review", created_at: "2026-08-10T00:00:00.000Z" },
    { id: "a2", company_name: "Nodal Exchange", job_title: "Data Coordinator", application_status: "saved", applied_date: null, signal_score: null, signal_decision: null, created_at: "2026-08-09T00:00:00.000Z" },
  ]

  beforeEach(() => {
    authFetchMock.mockReset()
    authFetchMock.mockImplementation(withApps(APP_ROWS))
  })

  it("counts them, names the company, and links each role back to the tracker", async () => {
    render(<CompanyCard company={company} onChanged={() => {}} onRequestDelete={() => {}} />)
    fireEvent.click(screen.getByLabelText(/Expand Nodal Exchange/))
    expect(await screen.findByText(/You've applied to 2 jobs at Nodal Exchange\./)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Operations Analyst" }).getAttribute("href"))
      .toBe("/dashboard/tracker/a1")
    // Same status words as the tracker itself, never a raw column value.
    expect(screen.getByText("Applied")).toBeTruthy()
    expect(screen.getByText("Saved")).toBeTruthy()
  })

  it("reads the scoped endpoint, not the full applications list", async () => {
    render(<CompanyCard company={company} onChanged={() => {}} onRequestDelete={() => {}} />)
    fireEvent.click(screen.getByLabelText(/Expand Nodal Exchange/))
    await screen.findByText(/You've applied to 2 jobs/)
    expect(authFetchMock.mock.calls.some((c) => c[0] === "/api/applications?company_id=co1")).toBe(true)
  })

  it("says nothing at all when no application is linked here", async () => {
    authFetchMock.mockImplementation(withApps([]))
    render(<CompanyCard company={company} onChanged={() => {}} onRequestDelete={() => {}} />)
    fireEvent.click(screen.getByLabelText(/Expand Nodal Exchange/))
    await waitFor(() => expect(screen.getByText("Jordan Alvarez")).toBeTruthy())
    // Most companies on a board have no application against them. A line
    // saying so on every card would be noise.
    expect(screen.queryByTestId("company-applications")).toBeNull()
    expect(screen.queryByText(/You've applied/)).toBeNull()
  })

  it("shows the roster even when the applications read fails", async () => {
    authFetchMock.mockImplementation((url: string) =>
      String(url).startsWith("/api/applications")
        ? Promise.resolve({ ok: false, status: 500, json: async () => ({ ok: false }) } as unknown as Response)
        : withApps([])(url))
    render(<CompanyCard company={company} onChanged={() => {}} onRequestDelete={() => {}} />)
    fireEvent.click(screen.getByLabelText(/Expand Nodal Exchange/))
    // allSettled, not all: one read failing must not blank the other.
    await waitFor(() => expect(screen.getByText("Jordan Alvarez")).toBeTruthy())
    // And it SAYS the check failed rather than reading as "nothing applied".
    expect(await screen.findByText(/couldn't check your applications at Nodal Exchange/i)).toBeTruthy()
  })

  it("shows the applications even when the contacts read fails", async () => {
    authFetchMock.mockImplementation((url: string) =>
      String(url).startsWith("/api/network/contacts")
        ? Promise.resolve({ ok: false, status: 500, json: async () => ({ ok: false }) } as unknown as Response)
        : withApps(APP_ROWS)(url))
    render(<CompanyCard company={company} onChanged={() => {}} onRequestDelete={() => {}} />)
    fireEvent.click(screen.getByLabelText(/Expand Nodal Exchange/))
    expect(await screen.findByText(/You've applied to 2 jobs at Nodal Exchange\./)).toBeTruthy()
  })
})
