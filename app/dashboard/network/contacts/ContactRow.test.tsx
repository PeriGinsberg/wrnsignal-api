// Component test for the CLIENT-STATE layer, the layer route-level tests
// cannot reach. This is the reference pattern; copy its shape for Phase 8's
// template editor.
//
// The shape is: render the component in isolation → fire a real user event →
// assert what the DOM does NEXT. The bug this pins down produced no request, no
// error and no server-side trace: on success `setBusy(null)` only ran in the
// catch, so after ONE successful action `busy` stayed set and every control in
// the row, gated on `disabled={busy !== null}`, went dead until reload. A
// disabled <select> cannot fire onChange, so the second interaction silently
// did nothing. Only a rendered DOM shows that.
//
// Note the two assertions are different claims and both are needed:
//   • the control re-enables      → the state actually cleared
//   • the second change dispatches → the control is genuinely usable, not just
//                                    un-disabled in the markup

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { Row, type Contact } from "./ContactRow"

// authFetch reaches for a Supabase browser session, which does not exist under
// jsdom. Stub the module rather than the global fetch so the test asserts on the
// call the COMPONENT makes, independent of how auth is attached.
const authFetchMock = vi.fn()
vi.mock("../authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getToken: async () => "test-token",
  // Real behaviour under a test URL with no ?client_profile_id: no subject,
  // and every href passes through untouched.
  subjectId: () => null,
  withSubject: (href: string) => href,
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

// A <tr> is only valid inside a table, and React will warn (noisily) otherwise.
function renderRow(overrides: Partial<Contact> = {}) {
  const onChanged = vi.fn()
  const utils = render(
    <table>
      <tbody>
        <Row contact={{ ...contact, ...overrides }} onChanged={onChanged} checked={false} onToggle={() => {}} />
      </tbody>
    </table>,
  )
  return { ...utils, onChanged }
}

describe("ContactRow: inline stage change", () => {
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

    // And the row must genuinely still work: this is the assertion that fails
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
