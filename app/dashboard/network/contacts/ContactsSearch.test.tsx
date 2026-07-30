// Search on the contacts spreadsheet. The three worked examples from the spec —
// "schr" finds Schreyer, "wolf" finds everyone at Wolf Greenfield, "litig" finds
// the litigation titles — plus the two properties that make it behave like the
// rest of the filter bar: it composes with them, and it lives in the URL.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react"
import ContactsPage from "./page"

let params = new URLSearchParams()
const replaceMock = vi.fn((url: string) => {
  // Behave like the real router: a replace changes what useSearchParams returns.
  // Without this the URL would be write-only and typing could never filter,
  // which is precisely the bug class this page had before.
  const qs = String(url).split("?")[1] ?? ""
  params = new URLSearchParams(qs)
})

vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dashboard/network/contacts",
}))

const authFetchMock = vi.fn()
vi.mock("../authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getToken: async () => "test-token",
}))

let seq = 0
function c(over: Record<string, unknown> = {}) {
  seq++
  return {
    id: `c${seq}`, first_name: "P", last_name: `Q${seq}`, title: null, email: null,
    stage: "identified", relationship: "cold", priority: "B", segment: "Seg A",
    next_due_at: null, next_due_reason: null, last_action_at: null,
    company_id: null, network_companies: null,
    first_touch_at: null, first_replied_at: null, first_chat_at: null, outcome_type: null,
    ...over,
  }
}

const WOLF = { id: "co1", name: "Wolf Greenfield" }

const ROSTER = [
  c({ first_name: "Dana", last_name: "Schreyer", title: "Litigation Associate",
      email: "dschreyer@wgpat.com", company_id: WOLF.id, network_companies: { name: WOLF.name },
      stage: "replied" }),
  c({ first_name: "Marcus", last_name: "Bell", title: "Litigation Partner",
      email: "mbell@wgpat.com", company_id: WOLF.id, network_companies: { name: WOLF.name } }),
  c({ first_name: "Priya", last_name: "Nandal", title: "Patent Prosecution Counsel",
      email: "pnandal@wgpat.com", company_id: WOLF.id, network_companies: { name: WOLF.name } }),
  c({ first_name: "Tom", last_name: "Okafor", title: "Litigation Analyst",
      email: "tokafor@fishrichardson.com", network_companies: { name: "Fish & Richardson" } }),
  c({ first_name: "Ida", last_name: "Vance", title: "Recruiter",
      email: "ida@northpoint.io", network_companies: { name: "Northpoint" } }),
]

// The spreadsheet is a list of row-objects now, not a <table>, so rows are
// found by their testid rather than by the table row role.
const rowEls = () => Array.from(document.querySelectorAll('[data-testid^="row-"]'))
const rows = () => rowEls().map((r) => r.textContent ?? "")
const shows = (n: string) => rows().some((t) => t.includes(n))
const visible = () => rowEls().length
const box = () => screen.getByTestId("contacts-search") as HTMLInputElement

afterEach(cleanup)
beforeEach(() => {
  params = new URLSearchParams()
  replaceMock.mockClear()
  authFetchMock.mockReset()
  authFetchMock.mockImplementation(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, contacts: ROSTER }) } as unknown as Response),
  )
})

async function arrive(qs = "") {
  params = new URLSearchParams(qs)
  const utils = render(<ContactsPage />)
  await waitFor(() => expect(screen.queryAllByTestId("contacts-search").length).toBe(1))
  return utils
}

// Type into the box, then re-render the way the router would after its replace.
async function type(term: string, rerender: (ui: React.ReactElement) => void) {
  fireEvent.change(box(), { target: { value: term } })
  rerender(<ContactsPage />)
  await waitFor(() => expect(box().value).toBe(term))
}

describe("typing filters the visible rows", () => {
  it('"schr" finds Schreyer', async () => {
    const { rerender } = await arrive()
    expect(visible()).toBe(5)

    await type("schr", rerender)
    expect(shows("Schreyer")).toBe(true)
    expect(visible()).toBe(1)
  })

  it('"wolf" finds everyone at Wolf Greenfield — a company match, not a name match', async () => {
    const { rerender } = await arrive()
    await type("wolf", rerender)

    expect(visible()).toBe(3)
    expect(shows("Schreyer")).toBe(true)
    expect(shows("Bell")).toBe(true)
    // Their email domain is wgpat.com deliberately: if it contained "wolf" this
    // assertion would pass with the company field removed entirely.
    expect(shows("Nandal")).toBe(true)
    expect(shows("Okafor")).toBe(false)
  })

  it('"litig" finds the litigation titles across companies', async () => {
    const { rerender } = await arrive()
    await type("litig", rerender)

    expect(visible()).toBe(3)
    expect(shows("Nandal")).toBe(false)  // same firm, different practice
    expect(shows("Okafor")).toBe(true)   // different firm, same practice
  })

  it("matches email, and is case-insensitive", async () => {
    const { rerender } = await arrive()
    await type("NORTHPOINT.IO", rerender)
    expect(visible()).toBe(1)
    expect(shows("Vance")).toBe(true)
  })

  it("matches across first and last name together", async () => {
    const { rerender } = await arrive()
    await type("dana schr", rerender)
    expect(visible()).toBe(1)
    expect(shows("Schreyer")).toBe(true)
  })

  it("a term matching nothing empties the table without hiding the search box", async () => {
    const { rerender } = await arrive()
    await type("zzzz", rerender)
    // The box must survive its own empty result, or there is no way to undo it —
    // the same trap the filter bar's contacts.length guard avoids.
    expect(screen.getByTestId("contacts-search")).toBeTruthy()
    expect(screen.getByText(/No contacts match these filters/i)).toBeTruthy()
  })
})

describe("search composes with the existing filters", () => {
  it("narrows WITHIN an active filter rather than replacing it", async () => {
    // Arrive already filtered to one stage, then search inside it.
    const { rerender } = await arrive("stage=replied")
    expect(visible()).toBe(1)
    expect(shows("Schreyer")).toBe(true)

    // "litig" alone matches three people; inside stage=replied only Schreyer is.
    await type("litig", rerender)
    expect(visible()).toBe(1)
    expect(shows("Schreyer")).toBe(true)
    expect(shows("Bell")).toBe(false)
    expect(shows("Okafor")).toBe(false)
  })

  it("keeps the other filter in the URL when the term is written", async () => {
    const { rerender } = await arrive("stage=replied")
    await type("litig", rerender)
    const url = String(replaceMock.mock.calls.at(-1)![0])
    expect(url).toContain("stage=replied")
    expect(url).toContain("q=litig")
  })

  it("Clear wipes the search term along with the dropdowns", async () => {
    const { rerender } = await arrive("stage=replied&q=litig")
    fireEvent.click(screen.getByRole("button", { name: /^Clear$/ }))
    rerender(<ContactsPage />)
    await waitFor(() => expect(visible()).toBe(5))
    expect(box().value).toBe("")
  })
})

describe("the term round-trips through the URL", () => {
  it("typing writes ?q= rather than holding private state", async () => {
    await arrive()
    replaceMock.mockClear()
    fireEvent.change(box(), { target: { value: "schr" } })
    expect(replaceMock).toHaveBeenCalledTimes(1)
    expect(String(replaceMock.mock.calls[0][0])).toContain("q=schr")
  })

  it("arriving at ?q= filters on arrival and shows the term in the box", async () => {
    await arrive("q=wolf")
    expect(visible()).toBe(3)
    expect(box().value).toBe("wolf")
  })

  it("re-filters when only the query string changes — back/forward and shared links", async () => {
    const { rerender } = await arrive("q=wolf")
    expect(shows("Okafor")).toBe(false)

    params = new URLSearchParams("q=litig")
    rerender(<ContactsPage />)
    await waitFor(() => expect(shows("Okafor")).toBe(true))
    expect(shows("Nandal")).toBe(false)
    expect(box().value).toBe("litig")
  })

  it("clearing the term returns the full list", async () => {
    const { rerender } = await arrive("q=schr")
    expect(visible()).toBe(1)

    await type("", rerender)
    expect(visible()).toBe(5)
  })
})

describe("the zero-contacts guard", () => {
  it("hides the search box when there are no contacts at all", async () => {
    authFetchMock.mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, contacts: [] }) } as unknown as Response),
    )
    render(<ContactsPage />)
    await waitFor(() => expect(screen.getByText(/No contacts yet/i)).toBeTruthy())

    // Same guard as the filter bar: an empty account meets the invitation, not
    // a row of machinery.
    expect(screen.queryByTestId("contacts-search")).toBeNull()
    expect(screen.queryAllByRole("combobox").length).toBe(0)
  })
})
