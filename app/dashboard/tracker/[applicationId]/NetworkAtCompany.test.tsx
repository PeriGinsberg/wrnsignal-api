// Component tests for "your network at this company".
//
// The four states, and the two rules that matter most in them: a name match
// only ever SUGGESTS (nothing links without a click), and the request shapes
// are not interchangeable, because the endpoint tells an absent company_id from
// an explicit null by key presence. A test that only checked "it posted" would
// pass while turning every link into an unlink.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { NetworkAtCompany } from "./NetworkAtCompany"

const authFetchMock = vi.fn()
vi.mock("../../network/authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getToken: async () => "test-token",
}))

const json = (body: unknown, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: async () => body } as unknown as Response)

const COMPANIES = [
  { id: "co-1", name: "Globex", contact_count: 2 },
  { id: "co-2", name: "Initech", contact_count: 0 },
]
const CONTACTS = [
  { id: "ct-1", first_name: "Dana", last_name: "Reed", title: "Head of Ops", stage: "replied" },
  { id: "ct-2", first_name: "Sam", last_name: "Ali", title: null, stage: "identified" },
]

/** Routes each call by URL, so a test never depends on call ordering. */
function routeFetch({ companies = COMPANIES, contacts = CONTACTS } = {}) {
  return (url: string, init?: RequestInit) => {
    if (String(url).startsWith("/api/network/companies/link-application")) return json({ ok: true })
    if (String(url).startsWith("/api/network/companies")) return json({ ok: true, companies })
    if (String(url).startsWith("/api/network/contacts")) return json({ ok: true, contacts })
    throw new Error(`unexpected url ${url}`)
  }
}

const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string)

afterEach(cleanup)
beforeEach(() => {
  authFetchMock.mockReset()
  authFetchMock.mockImplementation(routeFetch())
})

describe("NetworkAtCompany, unlinked with no name match", () => {
  it("offers to add the company, named", async () => {
    render(<NetworkAtCompany applicationId="app-1" companyName="Umbrella Health" companyId={null} onChanged={() => {}} />)
    expect(await screen.findByRole("button", { name: /Add Umbrella Health to your board/ })).toBeTruthy()
  })

  it("posts company_name, and does NOT send a company_id key at all", async () => {
    render(<NetworkAtCompany applicationId="app-1" companyName="Umbrella Health" companyId={null} onChanged={() => {}} />)
    fireEvent.click(await screen.findByRole("button", { name: /Add Umbrella Health/ }))
    await waitFor(() => expect(authFetchMock.mock.calls.length).toBeGreaterThan(1))
    const body = bodyOf(authFetchMock.mock.calls[1])
    expect(body).toEqual({ application_id: "app-1", company_name: "Umbrella Health" })
    // THE REGRESSION GUARD. `company_id: null` means unlink. If this request
    // carried the key at all, adding a company would clear the link instead.
    expect("company_id" in body).toBe(false)
  })

  it("offers the picker as an escape hatch when the names do not match", async () => {
    render(<NetworkAtCompany applicationId="app-1" companyName="Globex Corp" companyId={null} onChanged={() => {}} />)
    const picker = await screen.findByLabelText("Link to a company already on your board")
    fireEvent.change(picker, { target: { value: "co-1" } })
    await waitFor(() => expect(authFetchMock.mock.calls.length).toBeGreaterThan(1))
    expect(bodyOf(authFetchMock.mock.calls[1])).toEqual({ application_id: "app-1", company_id: "co-1" })
  })
})

describe("NetworkAtCompany, unlinked with a name match", () => {
  it("names the matched company and offers to link it", async () => {
    render(<NetworkAtCompany applicationId="app-1" companyName="globex" companyId={null} onChanged={() => {}} />)
    // Case-insensitive, the same comparison lower(name) makes in the index.
    expect(await screen.findByRole("button", { name: "Link to Globex" })).toBeTruthy()
  })

  it("SUGGESTS ONLY: nothing is linked until the button is clicked", async () => {
    render(<NetworkAtCompany applicationId="app-1" companyName="Globex" companyId={null} onChanged={() => {}} />)
    await screen.findByRole("button", { name: "Link to Globex" })
    // One read. No write.
    expect(authFetchMock.mock.calls.every((c) => !String(c[0]).includes("link-application"))).toBe(true)
  })

  it("posts the matched company_id on click", async () => {
    const onChanged = vi.fn()
    render(<NetworkAtCompany applicationId="app-1" companyName="Globex" companyId={null} onChanged={onChanged} />)
    fireEvent.click(await screen.findByRole("button", { name: "Link to Globex" }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(bodyOf(authFetchMock.mock.calls[1])).toEqual({ application_id: "app-1", company_id: "co-1" })
  })

  it("does not treat a near-miss as a match", async () => {
    render(<NetworkAtCompany applicationId="app-1" companyName="Globex Corporation" companyId={null} onChanged={() => {}} />)
    expect(await screen.findByRole("button", { name: /Add Globex Corporation to your board/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Link to/ })).toBeNull()
  })
})

describe("NetworkAtCompany, linked", () => {
  it("lists the contacts with their stage in words", async () => {
    render(<NetworkAtCompany applicationId="app-1" companyName="Globex" companyId="co-1" onChanged={() => {}} />)
    expect(await screen.findByRole("link", { name: "Dana Reed" })).toBeTruthy()
    expect(screen.getByText("They replied")).toBeTruthy()
    expect(screen.getByText("Not started")).toBeTruthy()
  })

  it("reads contacts scoped to the company", async () => {
    render(<NetworkAtCompany applicationId="app-1" companyName="Globex" companyId="co-1" onChanged={() => {}} />)
    await screen.findByRole("link", { name: "Dana Reed" })
    expect(authFetchMock.mock.calls[0][0]).toBe("/api/network/contacts?company_id=co-1")
  })

  it("says so when the company is linked but empty, and offers to add someone", async () => {
    authFetchMock.mockImplementation(routeFetch({ contacts: [] }))
    render(<NetworkAtCompany applicationId="app-1" companyName="Initech" companyId="co-2" onChanged={() => {}} />)
    expect(await screen.findByText(/No one at Initech yet/)).toBeTruthy()
    expect(screen.getByRole("link", { name: /Add someone at Initech/ })).toBeTruthy()
  })

  it("can unlink, sending company_id explicitly null", async () => {
    const onChanged = vi.fn()
    render(<NetworkAtCompany applicationId="app-1" companyName="Globex" companyId="co-1" onChanged={onChanged} />)
    fireEvent.click(await screen.findByTestId("unlink-company"))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const body = bodyOf(authFetchMock.mock.calls[1])
    expect(body).toEqual({ application_id: "app-1", company_id: null })
    // Explicitly present AND null. Absent would link by name instead.
    expect("company_id" in body).toBe(true)
    expect(body.company_id).toBeNull()
  })
})

describe("NetworkAtCompany, failures", () => {
  it("says the board could not be loaded rather than showing an empty state", async () => {
    authFetchMock.mockImplementation(() => json({ ok: false }, false, 500))
    render(<NetworkAtCompany applicationId="app-1" companyName="Globex" companyId="co-1" onChanged={() => {}} />)
    expect(await screen.findByText(/couldn't load your networking board/i)).toBeTruthy()
    // Must NOT read as "nobody works there", which is a different fact.
    expect(screen.queryByText(/No one at Globex yet/)).toBeNull()
  })

  it("surfaces a failed link instead of looking like it worked", async () => {
    authFetchMock.mockImplementation((url: string) =>
      String(url).includes("link-application")
        ? json({ ok: false, error: "Not authorized" }, false, 403)
        : routeFetch()(url))
    const onChanged = vi.fn()
    render(<NetworkAtCompany applicationId="app-1" companyName="Globex" companyId={null} onChanged={onChanged} />)
    fireEvent.click(await screen.findByRole("button", { name: "Link to Globex" }))
    expect(await screen.findByText("Not authorized")).toBeTruthy()
    expect(onChanged).not.toHaveBeenCalled()
  })
})
