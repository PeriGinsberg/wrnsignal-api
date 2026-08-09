// The board says out loud what its sort already knew.
//
// The list has been ranked by attention for a while and NOTHING ON SCREEN SAID
// SO. A tester looking at a correctly-ordered board answered "no" to "would you
// know who to contact first" — the answer was row one, and the board never
// claimed it. These pin the three things that changed: the bands are rendered
// and counted, the row says WHEN something is due rather than only how long it
// has been, and overdue is visually distinguishable from idle.
//
// Same harness as ContactsFilters.test.tsx: render the real page, stub the URL
// and authFetch, assert on the DOM.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, cleanup, within } from "@testing-library/react"
import ContactsPage from "./page"
import { ContactCard } from "./ContactCard"

const params = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dashboard/network/contacts",
}))

const authFetchMock = vi.fn()
vi.mock("../authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getToken: async () => "test-token",
}))

const DAY = 86400000
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString()

let seq = 0
function c(over: Record<string, unknown> = {}) {
  seq++
  return {
    id: `c${seq}`, first_name: "P", last_name: `Q${seq}`, title: null, stage: "sequence_active",
    relationship: "cold", priority: "B", segment: null, next_due_at: null, next_due_reason: null,
    last_action_at: null, company_id: null, network_companies: null,
    first_touch_at: null, first_replied_at: null, first_chat_at: null, outcome_type: null,
    ...over,
  }
}

/** One contact in each band, deliberately supplied OUT of priority order so a
 *  passing test cannot be explained by the server's ordering. */
const ROSTER = [
  c({ first_name: "Never", stage: "identified" }),                          // 4 not started
  c({ first_name: "Overdue", next_due_at: iso(-4), next_due_reason: "touch_2" }), // 0
  c({ first_name: "Resting", stage: "dormant_no_answer" }),                 // 5
  c({ first_name: "Today", next_due_at: iso(0), next_due_reason: "touch_2" }),    // 1
  c({ first_name: "Waiting", last_action_at: iso(-20) }),                   // 3
  c({ first_name: "Later", next_due_at: iso(6), next_due_reason: "touch_2" }),    // 2
]

beforeEach(() => {
  authFetchMock.mockReset()
  authFetchMock.mockImplementation((url: string) =>
    Promise.resolve({
      ok: true, status: 200,
      json: async () =>
        String(url).startsWith("/api/network/companies")
          ? { ok: true, companies: [] }
          : { ok: true, contacts: ROSTER },
    } as unknown as Response),
  )
})
afterEach(cleanup)

describe("the board names its own bands", () => {
  it("renders a heading per band, in priority order, with counts", async () => {
    render(<ContactsPage />)
    await waitFor(() => expect(screen.getByTestId("band-0")).toBeTruthy())

    // Every band the roster covers is labelled…
    expect(screen.getByTestId("band-0").textContent).toContain("Overdue")
    expect(screen.getByTestId("band-1").textContent).toContain("Due today")
    expect(screen.getByTestId("band-2").textContent).toContain("Due later")
    expect(screen.getByTestId("band-3").textContent).toContain("Waiting on them")
    expect(screen.getByTestId("band-4").textContent).toContain("Not started")
    expect(screen.getByTestId("band-5").textContent).toContain("Resting")

    // …and each says how many are under it.
    expect(screen.getByTestId("band-0").textContent).toContain("1")
  })

  it("puts the headings in the same sequence as the sort, most urgent first", async () => {
    render(<ContactsPage />)
    await waitFor(() => expect(screen.getByTestId("band-0")).toBeTruthy())

    // Read the rendered order out of the DOM rather than trusting the array.
    const order = Array.from(document.querySelectorAll("[data-testid^='band-']"))
      .map((el) => el.getAttribute("data-testid"))
    expect(order).toEqual(["band-0", "band-1", "band-2", "band-3", "band-4", "band-5"])
  })

  it("puts the overdue contact FIRST on the page, under its own heading", async () => {
    // The literal question she was asked: who do I contact first?
    render(<ContactsPage />)
    await waitFor(() => expect(screen.getByTestId("band-0")).toBeTruthy())
    const cards = screen.getAllByTestId("contact-card")
    // Matched on the DUE PHRASE, not on the word "Overdue" — the fixture is
    // also named that, and a test that passes on the person's name would pass
    // with the due line missing entirely.
    expect(within(cards[0]).getByText(/Overdue \d+ days?/)).toBeTruthy()
  })

  it("emits no heading for a band with nobody in it", async () => {
    authFetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true, status: 200,
        json: async () =>
          String(url).startsWith("/api/network/companies")
            ? { ok: true, companies: [] }
            : { ok: true, contacts: [c({ first_name: "Solo", stage: "identified" })] },
      } as unknown as Response),
    )
    render(<ContactsPage />)
    await waitFor(() => expect(screen.getByTestId("band-4")).toBeTruthy())
    // A wall of empty headings would be worse than none.
    expect(screen.queryByTestId("band-0")).toBeNull()
    expect(screen.queryByTestId("band-3")).toBeNull()
  })
})

describe("the card says WHEN, not just how long ago", () => {
  const render1 = (over: Record<string, unknown>) =>
    render(
      <ContactCard
        contact={c(over) as never}
        selectMode={false}
        checked={false}
        onToggle={() => {}}
        flash={false}
      />,
    )

  it("says how overdue it is", () => {
    render1({ next_due_at: iso(-3), next_due_reason: "touch_2", last_action_at: iso(-21) })
    expect(screen.getByText(/Overdue 3 days/)).toBeTruthy()
    // The elapsed line is REPLACED, not doubled up — two time facts on one row
    // is worse than either alone.
    expect(screen.queryByText(/3 weeks ago/)).toBeNull()
  })

  it("says due today", () => {
    render1({ next_due_at: iso(0), next_due_reason: "touch_2" })
    expect(screen.getByText("Due today")).toBeTruthy()
  })

  it("says how long until a future one", () => {
    render1({ next_due_at: iso(5), next_due_reason: "touch_2" })
    expect(screen.getByText(/Due in 5 days/)).toBeTruthy()
  })

  it("falls back to elapsed time when NOTHING is due", () => {
    // Rows waiting on the other person keep the recency line they always had.
    render1({ next_due_at: null, next_due_reason: null, last_action_at: iso(-2) })
    expect(screen.getByText(/ago/)).toBeTruthy()
  })

  it("makes overdue visually distinguishable from idle, not just differently worded", () => {
    // The whole failure was that an overdue row and an idle one were identical
    // to the eye. Assert the rail, not the text.
    const { unmount } = render1({ next_due_at: iso(-1), next_due_reason: "touch_2" })
    const overdueCard = screen.getByTestId("contact-card") as HTMLElement
    const railed = overdueCard.style.borderLeft
    expect(railed).toMatch(/3px/)
    unmount()

    render1({ next_due_at: null, next_due_reason: null })
    expect((screen.getByTestId("contact-card") as HTMLElement).style.borderLeft).not.toMatch(/3px/)
  })
})
