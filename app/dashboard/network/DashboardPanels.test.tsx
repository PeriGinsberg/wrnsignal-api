// Component tests for the dashboard panels: the funnel counts, the suppression
// threshold in BOTH directions, and that a funnel group is genuinely a link to
// the right filtered Contacts view.
//
// The last one matters most: a count you cannot click is a fact you cannot act
// on, and "the number rendered" says nothing about whether the link works.

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { DashboardPanels } from "./DashboardPanels"
import type { Contact } from "./contacts/ContactRow"

let seq = 0
function c(over: Partial<Contact> = {}): Contact {
  seq++
  return {
    id: `c${seq}`, first_name: "A", last_name: `B${seq}`, title: null, stage: "identified",
    relationship: null, priority: null, segment: null, next_due_at: null, next_due_reason: null,
    last_action_at: null, company_id: null, network_companies: null,
    first_touch_at: null, first_replied_at: null, first_chat_at: null, outcome_type: null,
    ...over,
  }
}
const touched = (over: Partial<Contact> = {}) => c({ first_touch_at: "2026-07-01T00:00:00Z", ...over })

afterEach(cleanup)

describe("funnel", () => {
  it("counts each phase group and keeps empty groups visible", () => {
    render(<DashboardPanels contacts={[
      c({ stage: "identified" }), c({ stage: "identified" }),
      c({ stage: "intro_requested" }), c({ stage: "sequence_active" }),
      c({ stage: "dormant_no_answer" }), c({ stage: "dormant_declined" }),
    ]} />)

    expect(screen.getByTestId("funnel-idle").getAttribute("data-count")).toBe("2")
    // Two different stages collapsing into one group is the whole point of phases.
    expect(screen.getByTestId("funnel-active").getAttribute("data-count")).toBe("2")
    expect(screen.getByTestId("funnel-resting").getAttribute("data-count")).toBe("2")
    // An empty group still renders — a zero reads as "nobody here yet", and a
    // disappearing group would make the funnel change shape as data arrives.
    expect(screen.getByTestId("funnel-won").getAttribute("data-count")).toBe("0")
    expect(screen.getAllByTestId(/^funnel-/)).toHaveLength(7)
  })

  it("each group links to Contacts with its ?phase= filter", () => {
    render(<DashboardPanels contacts={[c({ stage: "chat_done" })]} />)

    const momentum = screen.getByTestId("funnel-momentum")
    expect(momentum.tagName).toBe("A")
    expect(momentum.getAttribute("href")).toBe("/dashboard/network/contacts?phase=momentum")

    // Every group, not just the populated one — a dead link on an empty group is
    // still a dead link the moment data arrives.
    for (const p of ["idle", "active", "alive", "momentum", "longgame", "won", "resting"]) {
      expect(screen.getByTestId(`funnel-${p}`).getAttribute("href"))
        .toBe(`/dashboard/network/contacts?phase=${p}`)
    }
  })
})

describe("split suppression", () => {
  const rows = (n: number, replies: number, rel: string) =>
    Array.from({ length: n }, (_, i) =>
      touched({ relationship: rel, first_replied_at: i < replies ? "2026-07-02T00:00:00Z" : null }))

  it("BELOW the threshold: shows the count and says there is not enough data", () => {
    render(<DashboardPanels contacts={rows(4, 2, "cold")} />)
    const cell = screen.getByTestId("split-relationship-cold")
    expect(cell.getAttribute("data-suppressed")).toBe("true")
    expect(cell.textContent).toMatch(/not enough data yet \(4\/5\)/)
    // 2 of 4 is 50%, and that number must not appear anywhere.
    expect(cell.textContent).not.toMatch(/50%/)
  })

  it("AT the threshold: shows the rate", () => {
    render(<DashboardPanels contacts={rows(5, 3, "affinity")} />)
    const cell = screen.getByTestId("split-relationship-affinity")
    expect(cell.getAttribute("data-suppressed")).toBe("false")
    expect(cell.textContent).toMatch(/60%/)
    expect(cell.textContent).toMatch(/3\/5/)
    expect(cell.textContent).not.toMatch(/not enough data/)
  })

  it("keeps a suppressed row visible rather than hiding it", () => {
    // "We tried 3 recruiters and cannot tell yet" is information; an absent row
    // looks like the category was never tried.
    render(<DashboardPanels contacts={[...rows(3, 0, "recruiter"), ...rows(6, 2, "referred")]} />)
    expect(screen.getByTestId("split-relationship-recruiter")).toBeTruthy()
    expect(screen.getByTestId("split-relationship-referred")).toBeTruthy()
  })
})

describe("needs attention", () => {
  it("links each row to the filter that reproduces its own count", () => {
    const old = new Date(Date.now() - 20 * 86400000).toISOString()
    render(<DashboardPanels contacts={[
      c({ stage: "sequence_active", last_action_at: old }),
      c({ stage: "identified", priority: "A" }),
      c({ relationship: null }),
    ]} />)

    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"))
    expect(hrefs).toContain("/dashboard/network/contacts?status=stalled")
    expect(hrefs).toContain("/dashboard/network/contacts?priority=A&stage=identified")
    expect(hrefs).toContain("/dashboard/network/contacts?relationship=__none__")
  })
})

describe("empty board", () => {
  it("renders nothing at all rather than a wall of zeroes", () => {
    const { container } = render(<DashboardPanels contacts={[]} />)
    expect(container.textContent).toBe("")
  })
})
