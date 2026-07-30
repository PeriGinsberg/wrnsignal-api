// Component tests for the two card surfaces that replaced the spreadsheet row.
//
// Component test for the CLIENT-STATE layer — the layer route-level tests
// cannot reach. This is the reference pattern; copy its shape for Phase 8's
// template editor.
//
// The shape is: render the component in isolation → fire a real user event →
// assert what the DOM does NEXT. The bug this pins down produced no request, no
// error and no server-side trace: on success `setBusy(null)` only ran in the
// catch, so after ONE successful action `busy` stayed set and every control in
// the row — gated on `disabled={busy !== null}` — went dead until reload. A
// disabled <select> cannot fire onChange, so the second interaction silently
// did nothing. Only a rendered DOM shows that.
//
// Note the two assertions are different claims and both are needed:
//   • the control re-enables      → the state actually cleared
//   • the second change dispatches → the control is genuinely usable, not just
//                                    un-disabled in the markup

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { DueCard } from "./DueCard"
import { GridCard } from "./GridCard"
import { dueOf, needsMe, heroSort, type Contact } from "./contactModel"
import { LIGHT } from "../../../../lib/theme/surfaces"

// authFetch reaches for a Supabase browser session, which does not exist under
// jsdom. Stub the module rather than the global fetch so the test asserts on the
// call the COMPONENT makes, independent of how auth is attached.
const authFetchMock = vi.fn()
vi.mock("../authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getToken: async () => "test-token",
}))

const ok = () =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response)

const contact: Contact = {
  id: "c1",
  first_name: "Jordan",
  last_name: "Alvarez",
  title: "Analyst",
  stage: "identified",
  relationship: "personal",
  priority: "A",
  segment: null,
  next_due_at: null,
  next_due_reason: null,
  last_action_at: null,
  company_id: null,
  network_companies: null,
}

function renderDue(overrides: Partial<Contact> = {}) {
  const onChanged = vi.fn()
  const utils = render(
    <DueCard contact={{ ...contact, ...overrides }} onChanged={onChanged}
      selectMode={false} checked={false} onToggle={() => {}} />,
  )
  return { ...utils, onChanged }
}

function renderGrid(overrides: Partial<Contact> = {}, selectMode = false) {
  const onChanged = vi.fn()
  const onToggle = vi.fn()
  const utils = render(
    <GridCard contact={{ ...contact, ...overrides }} onChanged={onChanged}
      selectMode={selectMode} checked={false} onToggle={onToggle} />,
  )
  return { ...utils, onChanged, onToggle }
}

const DAYS = (n: number) => new Date(Date.now() + n * 86400000).toISOString()

describe("DueCard - inline stage change", () => {
  beforeEach(() => {
    authFetchMock.mockReset()
    authFetchMock.mockImplementation(ok)
  })
  afterEach(cleanup)

  it("stays usable after a successful change: the control re-enables and a second change still dispatches", async () => {
    const { onChanged } = renderDue()
    const stage = screen.getByLabelText("Stage") as HTMLSelectElement

    fireEvent.change(stage, { target: { value: "sequence_active" } })

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = authFetchMock.mock.calls[0]
    expect(url).toBe("/api/network/contacts/c1/stage")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ stage: "sequence_active" })

    // THE REGRESSION: busy must clear on SUCCESS, not only on failure.
    await waitFor(() => expect(stage.disabled).toBe(false))
    expect(onChanged).toHaveBeenCalledTimes(1)

    fireEvent.change(stage, { target: { value: "replied" } })
    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(authFetchMock.mock.calls[1][1].body)).toEqual({ stage: "replied" })
  })

  it("re-enables after a FAILED change too, and surfaces the error", async () => {
    authFetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 403, json: async () => ({ ok: false, error: "Forbidden" }) } as unknown as Response),
    )
    const { onChanged } = renderDue()
    const stage = screen.getByLabelText("Stage") as HTMLSelectElement

    fireEvent.change(stage, { target: { value: "sequence_active" } })

    await waitFor(() => expect(screen.getByText("Forbidden")).toBeTruthy())
    expect(stage.disabled).toBe(false)
    expect(onChanged).not.toHaveBeenCalled()

    fireEvent.change(stage, { target: { value: "replied" } })
    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(2))
  })

  it("logs the due touch through the same action route the row used", async () => {
    renderDue({ next_due_at: DAYS(-2), next_due_reason: "touch_2" })
    fireEvent.click(screen.getByTestId("act-c1"))
    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1))
    expect(String(authFetchMock.mock.calls[0][0])).toBe("/api/network/contacts/c1/actions")
  })

  it("stays put and says so when its work is done, rather than vanishing", () => {
    // The partition is frozen, so a card whose due state has cleared is still
    // HERE. It must read as finished instead of looking like a bug.
    renderDue({ next_due_at: null, next_due_reason: null })
    expect(screen.getByTestId("card-c1").getAttribute("data-settled")).toBe("true")
    expect(screen.getByTestId("due-c1").textContent).toBe("Done for now")
    cleanup()

    renderDue({ next_due_at: DAYS(-1), next_due_reason: "touch_2" })
    expect(screen.getByTestId("card-c1").getAttribute("data-settled")).toBe("false")
  })
})

describe("GridCard - restraint, and what breaks it", () => {
  beforeEach(() => {
    authFetchMock.mockReset()
    authFetchMock.mockImplementation(ok)
  })
  afterEach(cleanup)

  it("shows almost nothing for a contact nobody has started", () => {
    renderGrid({ stage: "identified", relationship: null, priority: null })
    expect(screen.getByTestId("whisper-c1").textContent).toBe("Not started")
    expect(screen.queryByTestId("stage-c1")).toBeNull()
    expect(screen.queryByTestId("due-c1")).toBeNull()
    expect(screen.queryByTestId("rel-c1")).toBeNull()
  })

  it("lights up once the contact is being worked", () => {
    renderGrid({ stage: "replied" })
    expect(screen.getByTestId("stage-c1")).toBeTruthy()
    expect(screen.queryByTestId("whisper-c1")).toBeNull()
  })

  it("still shows a due chip, because hero overflow lands in the grid", () => {
    renderGrid({ stage: "sequence_active", next_due_at: DAYS(-4) })
    expect(screen.getByTestId("due-c1").textContent).toMatch(/Overdue/)
  })

  it("reveals the stage control on hover for EVERY card, idle included", async () => {
    const { container } = renderGrid({ stage: "identified" })
    expect(screen.queryByTestId("set-stage-c1")).toBeNull()

    fireEvent.mouseEnter(container.firstChild as Element)
    const stage = screen.getByTestId("set-stage-c1") as HTMLSelectElement
    fireEvent.change(stage, { target: { value: "sequence_active" } })

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1))
    expect(String(authFetchMock.mock.calls[0][0])).toBe("/api/network/contacts/c1/stage")
  })

  it("in select mode, clicking the card selects instead of navigating", () => {
    const { container, onToggle } = renderGrid({}, true)
    fireEvent.click(container.firstChild as Element)
    expect(onToggle).toHaveBeenCalled()
  })
})

describe("the model behind the two worlds", () => {
  it("ranks the hero: overdue deepest first, then today, then soonest", () => {
    const mk = (id: string, at: string | null): Contact => ({ ...contact, id, next_due_at: at })
    const sorted = heroSort([
      mk("today", DAYS(0)),
      mk("soon", DAYS(3)),
      mk("deep", DAYS(-9)),
      mk("shallow", DAYS(-1)),
    ]).map((c) => c.id)
    expect(sorted).toEqual(["deep", "shallow", "today", "soon"])
  })

  it("carries a MEANING on the due state, not a hardcoded colour", () => {
    expect(dueOf(DAYS(-2)).meaning).toBe("error")
    expect(dueOf(DAYS(0)).meaning).toBe("attention")
    expect(dueOf(DAYS(5)).meaning).toBe("idle")
    expect(needsMe(dueOf(DAYS(-2)))).toBe(true)
    expect(needsMe(dueOf(DAYS(5)))).toBe(false)
    expect(needsMe(dueOf(null))).toBe(false)
  })
})
