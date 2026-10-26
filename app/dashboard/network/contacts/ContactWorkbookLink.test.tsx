import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { ContactCard } from "./ContactCard"
import type { Contact } from "./ContactRow"

// The contact card links to the contact's Networking workbook: the client's
// own workbook page on their board, the client's Workbooks tab for a coach.

const base: Contact = {
  id: "c1", first_name: "Marcus", last_name: "Vale", title: null, stage: "identified",
  relationship: null, priority: null, segment: null, next_due_at: null,
  next_due_reason: null, last_action_at: null, company_id: null,
}

function at(search = "") {
  window.history.replaceState({}, "", "/dashboard/network" + search)
}
const link = () => screen.queryByTestId("contact-workbook-link")

describe("contact card workbook link", () => {
  beforeEach(() => at())
  afterEach(cleanup)

  it("shows nothing when the contact has no workbook", () => {
    render(<ContactCard contact={base} />)
    expect(link()).toBeNull()
  })

  it("opens the client's own workbook on their board", () => {
    render(<ContactCard contact={{ ...base, workbook_id: "wb-1" }} />)
    expect(link()?.getAttribute("href")).toBe("/dashboard/workbooks/wb-1")
  })

  it("opens the client's Workbooks tab for a coach", () => {
    at("?client_profile_id=client-1")
    render(<ContactCard contact={{ ...base, workbook_id: "wb-1" }} />)
    expect(link()?.getAttribute("href")).toBe("/dashboard/coach/clients/client-1?tab=workbooks&workbook=wb-1")
  })
})
