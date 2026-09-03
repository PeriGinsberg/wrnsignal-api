import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { ContactCard } from "./ContactCard"
import type { Contact } from "./ContactRow"

// "Added by your coach", on the roster.
//
// The rule is that attribution is always on and never hideable, which is not
// the same as always VISIBLE: a caption on every client-created row would be
// noise on the whole board and would bury the one case worth seeing. So the
// badge appears only for rows a coach created, and the wording turns on who is
// reading, because "your coach" is true on the client's own board and is not
// true for a coach reading someone else's.

const base: Contact = {
  id: "c1",
  first_name: "Marcus",
  last_name: "Vale",
  title: "VP Engineering",
  stage: "identified",
  relationship: null,
  priority: null,
  segment: null,
  next_due_at: null,
  next_due_reason: null,
  last_action_at: null,
  company_id: null,
}

function at(search = "") {
  window.history.replaceState({}, "", "/dashboard/network" + search)
}

const badge = () => screen.queryByTestId("contact-attribution")

describe("roster attribution", () => {
  beforeEach(() => at())
  afterEach(cleanup)

  it("says nothing about a contact the client added themselves", () => {
    render(<ContactCard contact={base} />)
    expect(badge()).toBeNull()
  })

  it("says nothing when the flags are absent entirely", () => {
    // Every caller written before coach access sends neither flag. A missing
    // flag must read as "the client added this", not as an unknown to caption.
    render(<ContactCard contact={{ ...base, added_by_coach: undefined }} />)
    expect(badge()).toBeNull()
  })

  it("tells the client when their coach added someone", () => {
    render(<ContactCard contact={{ ...base, added_by_coach: true }} />)
    expect(badge()?.textContent).toBe("Added by your coach")
  })

  it("says 'by you' to the coach who added them", () => {
    at("?client_profile_id=client-1")
    render(<ContactCard contact={{ ...base, added_by_coach: true, added_by_you: true }} />)
    expect(badge()?.textContent).toBe("Added by you")
  })

  // A board can have more than one coach on it, and a coach reading it cannot
  // be told "your coach" about a row that is not theirs.
  it("says 'a coach' to a coach reading someone else's row", () => {
    at("?client_profile_id=client-1")
    render(<ContactCard contact={{ ...base, added_by_coach: true, added_by_you: false }} />)
    expect(badge()?.textContent).toBe("Added by a coach")
  })

  it("still renders the contact itself alongside the badge", () => {
    render(<ContactCard contact={{ ...base, added_by_coach: true }} />)
    expect(screen.getByText("Marcus Vale")).toBeTruthy()
  })
})
