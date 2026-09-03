import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react"
import { CompanyPanel } from "./CompanyPanel"

// ADDING SOMEONE AT THE COMPANY YOU ARE ALREADY LOOKING AT.
//
// The panel exists because you want to know about a company while you are
// about to write to someone who works there. The same is true one step later:
// you read who you already know there, notice a gap, and want to add a person.
// Until now that cost closing the panel, scrolling to the header, and retyping
// the company name you had just been reading.

const authFetchMock = vi.fn()
vi.mock("./authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getToken: async () => "test-token",
  subjectId: () => null,
  withSubject: (href: string) => href,
}))

const COMPANY = { id: "co-1", name: "Globex", domain: null, tier: null, status: null, notes: null, contact_count: 2 }

const json = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body } as unknown as Response)

afterEach(cleanup)
beforeEach(() => {
  authFetchMock.mockReset()
  authFetchMock.mockImplementation((url: string) =>
    String(url).startsWith("/api/network/contacts")
      ? json({ ok: true, contacts: [] })
      : json({ ok: true, companies: [COMPANY] }))
})

const addBtn = () => screen.queryByTestId("panel-add-contact")

describe("CompanyPanel", () => {
  it("offers to add a contact at the company it is showing", async () => {
    render(<CompanyPanel companyId="co-1" onClose={() => {}} onAddContact={() => {}} />)
    await waitFor(() => expect(addBtn()).toBeTruthy())
    // Names the company, so the button is a sentence rather than a guess about
    // which company "here" means.
    expect(addBtn()!.textContent).toContain("Globex")
  })

  it("hands the company name back, so the form opens knowing where", async () => {
    const onAddContact = vi.fn()
    render(<CompanyPanel companyId="co-1" onClose={() => {}} onAddContact={onAddContact} />)
    await waitFor(() => expect(addBtn()).toBeTruthy())
    fireEvent.click(addBtn()!)
    expect(onAddContact).toHaveBeenCalledWith("Globex")
  })

  // Absent prop, absent button: surfaces with nowhere to put a form must not
  // grow a control that leads nowhere.
  it("renders no button when the caller cannot open a form", async () => {
    render(<CompanyPanel companyId="co-1" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText("Globex")).toBeTruthy())
    expect(addBtn()).toBeNull()
  })

  // The panel stays open behind the modal, so after the add it must not still
  // be describing the board as it was one person ago.
  it("reloads when the caller says a contact was added", async () => {
    const { rerender } = render(
      <CompanyPanel companyId="co-1" onClose={() => {}} reloadToken={0} onAddContact={() => {}} />,
    )
    await waitFor(() => expect(addBtn()).toBeTruthy())
    const before = authFetchMock.mock.calls.filter((c) => c[0] === "/api/network/companies").length

    rerender(<CompanyPanel companyId="co-1" onClose={() => {}} reloadToken={1} onAddContact={() => {}} />)
    await waitFor(() =>
      expect(authFetchMock.mock.calls.filter((c) => c[0] === "/api/network/companies").length)
        .toBeGreaterThan(before))
  })

  it("stays closed with no company selected", () => {
    const { container } = render(<CompanyPanel companyId={null} onClose={() => {}} onAddContact={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})
