// The two-world split: what goes in TODAY, what falls to EVERYONE, and the two
// invariants that keep the page still while someone works in it.
//
// The partition test is the important one. Acting on a hero card changes
// next_due_at, which changes needsMe, which would move the card into the grid on
// the next load. Frozen partition is what stops the card you just clicked from
// teleporting out from under you.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react"
import ContactsPage from "./page"
import { HERO_CAP } from "./contactModel"

let params = new URLSearchParams()
const replaceMock = vi.fn((url: string) => { params = new URLSearchParams(String(url).split("?")[1] ?? "") })
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

const DAYS = (n: number) => new Date(Date.now() + n * 86400000).toISOString()

let seq = 0
function c(over: Record<string, unknown> = {}) {
  seq++
  return {
    id: `c${seq}`, first_name: "P", last_name: `Q${seq}`, title: null, stage: "sequence_active",
    relationship: "cold", priority: "B", segment: null, next_due_at: null, next_due_reason: null,
    last_action_at: null, company_id: null, network_companies: null,
    ...over,
  }
}

let ROSTER: ReturnType<typeof c>[] = []

function api() {
  return (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url)
    if (u === "/api/network/contacts" && (init?.method ?? "GET") === "GET")
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, contacts: ROSTER }) } as unknown as Response)
    // An action clears the due date, the way the reminder engine would.
    if (u.includes("/actions")) {
      const id = u.split("/")[4]
      ROSTER = ROSTER.map((x) => (x.id === id ? { ...x, next_due_at: null, next_due_reason: null } : x))
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, deleted: 2 }) } as unknown as Response)
  }
}

const cards = () => Array.from(document.querySelectorAll('[data-testid^="card-"]'))
const inWorld = (w: "hero" | "grid") =>
  cards().filter((e) => e.getAttribute("data-world") === w).map((e) => e.getAttribute("data-testid")!)

afterEach(cleanup)
beforeEach(() => {
  params = new URLSearchParams()
  seq = 0
  replaceMock.mockClear()
  authFetchMock.mockReset()
  authFetchMock.mockImplementation(api())
})

async function arrive() {
  const utils = render(<ContactsPage />)
  await waitFor(() => expect(screen.queryByTestId("today-hero")).toBeTruthy())
  return utils
}

describe("the split", () => {
  it("puts due and overdue contacts in TODAY and everyone else in EVERYONE", async () => {
    ROSTER = [
      c({ first_name: "Over", next_due_at: DAYS(-3), next_due_reason: "touch_2" }),
      c({ first_name: "Today", next_due_at: DAYS(0), next_due_reason: "touch_2" }),
      c({ first_name: "Later", next_due_at: DAYS(6) }),
      c({ first_name: "Idle", stage: "identified" }),
    ]
    await arrive()
    expect(inWorld("hero")).toEqual(["card-c1", "card-c2"])
    expect(inWorld("grid")).toEqual(["card-c3", "card-c4"])
    expect(screen.getByTestId("hero-headline").textContent).toBe("2 people need you")
  })

  it("caps the hero and drops the overflow into the grid", async () => {
    ROSTER = Array.from({ length: HERO_CAP + 3 }, (_, i) =>
      c({ next_due_at: DAYS(-(i + 1)), next_due_reason: "touch_2" }))
    await arrive()

    expect(inWorld("hero").length).toBe(HERO_CAP)
    expect(screen.getByTestId("hero-overflow").textContent).toContain("3 more due")
    // The overflow is not lost, it is in the grid, which is where the chip goes.
    expect(inWorld("grid").length).toBe(3)
  })

  it("orders the hero by urgency, deepest overdue first", async () => {
    ROSTER = [
      c({ first_name: "Shallow", next_due_at: DAYS(-1), next_due_reason: "touch_2" }),
      c({ first_name: "Today", next_due_at: DAYS(0), next_due_reason: "touch_2" }),
      c({ first_name: "Deep", next_due_at: DAYS(-9), next_due_reason: "touch_2" }),
    ]
    await arrive()
    expect(inWorld("hero")).toEqual(["card-c3", "card-c1", "card-c2"])
  })

  it("says so calmly when nothing is due", async () => {
    ROSTER = [c({ first_name: "Idle", stage: "identified" })]
    await arrive()
    expect(screen.getByTestId("hero-empty")).toBeTruthy()
    expect(screen.getByTestId("hero-headline").textContent).toBe("You are all caught up")
    expect(screen.queryByTestId("hero-overflow")).toBeNull()
  })

  it("tells the grid why it is empty when everyone is in the hero", async () => {
    ROSTER = [c({ next_due_at: DAYS(-1), next_due_reason: "touch_2" })]
    await arrive()
    expect(screen.getByTestId("grid-empty").textContent).toMatch(/Everyone who needs you is in TODAY/)
  })
})

describe("the frozen partition", () => {
  it("keeps an actioned card in TODAY instead of teleporting it to the grid", async () => {
    ROSTER = [
      c({ first_name: "Act", next_due_at: DAYS(-2), next_due_reason: "touch_2" }),
      c({ first_name: "Idle", stage: "identified" }),
    ]
    await arrive()
    expect(inWorld("hero")).toEqual(["card-c1"])

    // Log the due touch. The server-side fixture clears next_due_at, so a live
    // partition would move this card out from under the click.
    fireEvent.click(screen.getByTestId("act-c1"))
    await waitFor(() => expect(screen.getByTestId("card-c1").getAttribute("data-settled")).toBe("true"))

    // Still in TODAY, and now reading as finished rather than gone.
    expect(inWorld("hero")).toEqual(["card-c1"])
    expect(screen.getByTestId("due-c1").textContent).toBe("Done for now")
    // The headline drops even though the partition held.
    expect(screen.getByTestId("hero-headline").textContent).toBe("You are all caught up")
  })
})

describe("select mode", () => {
  beforeEach(() => {
    ROSTER = [
      c({ first_name: "Due", next_due_at: DAYS(-1), next_due_reason: "touch_2" }),
      c({ first_name: "Calm", stage: "identified" }),
    ]
  })

  it("is off by default, so no checkbox clutters a card", async () => {
    await arrive()
    expect(screen.queryByTestId("selection-bar")).toBeNull()
    expect(screen.queryAllByLabelText("Select contact").length).toBe(0)
  })

  it("turns on, reveals selection across BOTH worlds, and select-all spans them", async () => {
    await arrive()
    fireEvent.click(screen.getByTestId("select-mode"))

    expect(screen.getByTestId("selection-bar")).toBeTruthy()
    expect(screen.getAllByLabelText("Select contact").length).toBe(2)   // hero + grid

    fireEvent.click(screen.getByTestId("select-all"))
    await waitFor(() => expect(screen.getByTestId("selected-count").textContent).toBe("2 selected"))
  })

  it("opens the delete confirmation, which still names who is going", async () => {
    await arrive()
    fireEvent.click(screen.getByTestId("select-mode"))
    fireEvent.click(screen.getByTestId("select-all"))
    await waitFor(() => expect(screen.getByTestId("selected-count").textContent).toBe("2 selected"))

    fireEvent.click(screen.getByTestId("bulk-delete"))
    // Match the modal's own line, not the bar's "Delete 2" button.
    await waitFor(() => expect(screen.getByText(/This removes their action logs/)).toBeTruthy())
  })

  it("leaves select mode on Escape and drops the selection", async () => {
    await arrive()
    fireEvent.click(screen.getByTestId("select-mode"))
    fireEvent.click(screen.getByTestId("select-all"))
    await waitFor(() => expect(screen.getByTestId("selected-count").textContent).toBe("2 selected"))

    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => expect(screen.queryByTestId("selection-bar")).toBeNull())
  })
})
