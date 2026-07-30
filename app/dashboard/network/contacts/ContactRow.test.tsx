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
import { Row, dueOf, needsMe, type Contact } from "./ContactRow"
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

// A row-object is a plain element now, so no table wrapper is needed.
function renderRow(overrides: Partial<Contact> = {}) {
  const onChanged = vi.fn()
  const utils = render(
    <Row contact={{ ...contact, ...overrides }} onChanged={onChanged} checked={false} onToggle={() => {}} />,
  )
  return { ...utils, onChanged }
}

const DAYS = (n: number) => new Date(Date.now() + n * 86400000).toISOString()

// jsdom serialises every colour to rgb(), so an assertion has to compare in the
// same form rather than against the hex the token is written in.
const rgb = (hex: string) =>
  `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`

describe("ContactRow — inline stage change", () => {
  beforeEach(() => {
    authFetchMock.mockReset()
    authFetchMock.mockImplementation(ok)
  })
  afterEach(cleanup)

  it("stays usable after a successful change: the control re-enables and a second change still dispatches", async () => {
    const { onChanged } = renderRow()
    const stage = screen.getByLabelText("Stage") as HTMLSelectElement

    fireEvent.change(stage, { target: { value: "sequence_active" } })

    // First call fired, with the payload the stage route expects.
    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = authFetchMock.mock.calls[0]
    expect(url).toBe("/api/network/contacts/c1/stage")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ stage: "sequence_active" })

    // THE REGRESSION: busy must clear on SUCCESS, not only on failure.
    await waitFor(() => expect(stage.disabled).toBe(false))
    expect(onChanged).toHaveBeenCalledTimes(1)

    // And the row must genuinely still work — this is the assertion that fails
    // if `finally` regresses back to a catch-only reset.
    fireEvent.change(stage, { target: { value: "replied" } })
    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(authFetchMock.mock.calls[1][1].body)).toEqual({ stage: "replied" })
  })

  it("re-enables after a FAILED change too, and surfaces the error", async () => {
    authFetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 403, json: async () => ({ ok: false, error: "Forbidden" }) } as unknown as Response),
    )
    const { onChanged } = renderRow()
    const stage = screen.getByLabelText("Stage") as HTMLSelectElement

    fireEvent.change(stage, { target: { value: "sequence_active" } })

    await waitFor(() => expect(screen.getByText("Forbidden")).toBeTruthy())
    expect(stage.disabled).toBe(false)
    expect(onChanged).not.toHaveBeenCalled()

    // Still retryable after an error.
    fireEvent.change(stage, { target: { value: "replied" } })
    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(2))
  })
})

describe("the row-object says who needs me", () => {
  // The file's other cleanup hook is scoped to the describe above it.
  afterEach(cleanup)

  it("lifts a row that is overdue or due today, and leaves the rest flat", () => {
    renderRow({ next_due_at: DAYS(-3) })
    expect(screen.getByTestId("row-c1").getAttribute("data-lifted")).toBe("true")
    cleanup()

    renderRow({ next_due_at: DAYS(0) })
    expect(screen.getByTestId("row-c1").getAttribute("data-lifted")).toBe("true")
    cleanup()

    renderRow({ next_due_at: DAYS(6) })
    expect(screen.getByTestId("row-c1").getAttribute("data-lifted")).toBe("false")
    cleanup()

    renderRow({ next_due_at: null })
    expect(screen.getByTestId("row-c1").getAttribute("data-lifted")).toBe("false")
  })

  it("puts a lifted row on the raised surface and a flat one on the card", () => {
    renderRow({ next_due_at: DAYS(-1) })
    expect(screen.getByTestId("row-c1").style.background).toContain(rgb(LIGHT.raised))
    cleanup()

    renderRow({ next_due_at: null })
    const flat = screen.getByTestId("row-c1").style.background
    expect(flat).toContain(rgb(LIGHT.card))
    expect(flat).not.toContain(rgb(LIGHT.raised))
  })

  it("carries a MEANING on the due chip, not a hardcoded colour", () => {
    // The chip has to read correctly on either surface, so dueOf names the
    // meaning and the surface supplies the value.
    expect(dueOf(DAYS(-2)).meaning).toBe("error")
    expect(dueOf(DAYS(0)).meaning).toBe("attention")
    expect(dueOf(DAYS(5)).meaning).toBe("idle")
    expect(dueOf(null).meaning).toBe("idle")

    expect(needsMe(dueOf(DAYS(-2)))).toBe(true)
    expect(needsMe(dueOf(DAYS(0)))).toBe(true)
    expect(needsMe(dueOf(DAYS(5)))).toBe(false)
    expect(needsMe(dueOf(null))).toBe(false)
  })

  it("renders the designed parts: initial, attributes, stage, due chip", () => {
    renderRow({ next_due_at: DAYS(0), next_due_reason: "touch_2" })
    expect(screen.getByTestId("avatar-c1").textContent).toBe("JA")
    expect(screen.getByTestId("rel-c1").textContent).toBe("Personal")
    expect(screen.getByTestId("pri-c1").textContent).toBe("A")
    expect(screen.getByTestId("due-c1").textContent).toBe("Due today")
    expect(screen.getByTestId("log-c1")).toBeTruthy()
  })

  it("colours the initial by pipeline phase, so the left edge already says the state", () => {
    renderRow({ stage: "replied" })
    expect(screen.getByTestId("avatar-c1").style.color).toBeTruthy()
    // replied maps to the "replied" meaning, whose ink is the light green.
    expect(screen.getByTestId("avatar-c1").getAttribute("style"))
      .toContain(rgb(LIGHT.meaning.replied.ink))
  })
})
