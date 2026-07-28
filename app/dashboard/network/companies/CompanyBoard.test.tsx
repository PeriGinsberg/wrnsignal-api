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

describe("CompanyCard — lazy load", () => {
  beforeEach(() => {
    authFetchMock.mockReset()
    authFetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          contacts: [
            { id: "p1", first_name: "Jordan", last_name: "Alvarez", title: "Analyst", stage: "replied" },
          ],
        }),
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
    expect(authFetchMock).toHaveBeenCalledTimes(1)
    expect(authFetchMock.mock.calls[0][0]).toBe("/api/network/contacts?company_id=co1")
  })

  it("fetches contacts on first expand only — collapse and re-expand do not refetch", async () => {
    render(<CompanyCard company={company} onChanged={() => {}} onRequestDelete={() => {}} />)

    // Nothing fetched until opened.
    expect(authFetchMock).not.toHaveBeenCalled()

    const toggle = screen.getByLabelText(/Expand Nodal Exchange/)
    fireEvent.click(toggle)

    await waitFor(() => expect(screen.getByText("Jordan Alvarez")).toBeTruthy())
    expect(authFetchMock).toHaveBeenCalledTimes(1)
    expect(authFetchMock.mock.calls[0][0]).toBe("/api/network/contacts?company_id=co1")

    // Collapse, then re-expand: the row is still there and NO second request.
    fireEvent.click(screen.getByLabelText(/Collapse Nodal Exchange/))
    fireEvent.click(screen.getByLabelText(/Expand Nodal Exchange/))
    await waitFor(() => expect(screen.getByText("Jordan Alvarez")).toBeTruthy())
    expect(authFetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not refetch a genuinely empty company on re-expand", async () => {
    authFetchMock.mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, contacts: [] }) } as unknown as Response),
    )
    render(<CompanyCard company={{ ...company, contact_count: 0 }} onChanged={() => {}} onRequestDelete={() => {}} />)

    fireEvent.click(screen.getByLabelText(/Expand Nodal Exchange/))
    await waitFor(() => expect(screen.getByText(/No contacts here yet/)).toBeTruthy())
    expect(authFetchMock).toHaveBeenCalledTimes(1)

    // `loaded` is tracked separately from contacts.length, so zero contacts must
    // not look like "never loaded" and trigger a refetch loop.
    fireEvent.click(screen.getByLabelText(/Collapse Nodal Exchange/))
    fireEvent.click(screen.getByLabelText(/Expand Nodal Exchange/))
    await waitFor(() => expect(screen.getByText(/No contacts here yet/)).toBeTruthy())
    expect(authFetchMock).toHaveBeenCalledTimes(1)
  })
})
