// "Create Networking Workbook": the contact is required, one workbook per
// contact, and Create posts the picked contact and nothing else.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { CreateWorkbookModal } from "./CreateWorkbookModal"
import type { Contact } from "./contacts/ContactRow"

const authFetchMock = vi.fn()
vi.mock("./authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  networkingWorkbookHref: (id: string) => `/dashboard/workbooks/${id}`,
}))

const contact = (id: string, first: string, extra: Partial<Contact> = {}): Contact => ({
  id, first_name: first, last_name: "Lee", title: null, stage: "identified", relationship: null,
  priority: null, segment: null, next_due_at: null, next_due_reason: null, last_action_at: null,
  company_id: null, ...extra,
})

const contacts = [contact("c1", "Jordan"), contact("c2", "Avery", { workbook_id: "wb-2" })]
const createBtn = () => screen.getByRole("button", { name: "Create workbook" }) as HTMLButtonElement

let href = ""
beforeEach(() => {
  authFetchMock.mockReset()
  href = ""
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { set href(v: string) { href = v }, get href() { return href }, search: "" },
  })
})
afterEach(cleanup)

describe("CreateWorkbookModal", () => {
  it("keeps Create disabled until a contact is picked", () => {
    render(<CreateWorkbookModal contacts={contacts} onClose={() => {}} />)
    expect(createBtn().disabled).toBe(true)
    fireEvent.click(screen.getByText("Jordan Lee"))
    expect(createBtn().disabled).toBe(false)
  })

  it("offers Open, not a pick, for a contact that already has a workbook", () => {
    render(<CreateWorkbookModal contacts={contacts} onClose={() => {}} />)
    fireEvent.click(screen.getByText("Avery Lee"))
    expect(createBtn().disabled).toBe(true)
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/dashboard/workbooks/wb-2")
  })

  it("posts the picked contact and opens the new workbook", async () => {
    authFetchMock.mockResolvedValue({
      ok: true, status: 201, json: async () => ({ ok: true, workbook: { id: "wb-new" } }),
    } as unknown as Response)
    render(<CreateWorkbookModal contacts={contacts} onClose={() => {}} />)
    fireEvent.click(screen.getByText("Jordan Lee"))
    fireEvent.click(createBtn())
    await waitFor(() => expect(href).toBe("/dashboard/workbooks/wb-new"))
    const [url, init] = authFetchMock.mock.calls[0]
    expect(url).toBe("/api/me/workbooks/networking")
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ contact_id: "c1" })
  })

  it("shows the route's error and stays open", async () => {
    authFetchMock.mockResolvedValue({
      ok: false, status: 404, json: async () => ({ ok: false, error: "Contact not found" }),
    } as unknown as Response)
    render(<CreateWorkbookModal contacts={contacts} onClose={() => {}} />)
    fireEvent.click(screen.getByText("Jordan Lee"))
    fireEvent.click(createBtn())
    expect((await screen.findByRole("alert")).textContent).toBe("Contact not found")
    expect(href).toBe("")
  })
})
