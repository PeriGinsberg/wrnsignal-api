// Component tests for the phase bar + stage dropdown.
//
// Interacts with the dropdown the way a user does — finds it by its visible
// field label and fires a change — rather than calling setStage directly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { PipelineStepper, PhaseBar } from "./PipelineStepper"

const authFetchMock = vi.fn()
vi.mock("../../authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getToken: async () => "test-token",
}))

const ok = () =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response)

const contact = { id: "c1", stage: "identified", outcome_type: null, relationship: "personal" }

// Which segment is lit, read off the DOM rather than off the component's props.
function litPhase(container: HTMLElement): string | null {
  const el = container.querySelector('[data-active="true"]')
  return el?.getAttribute("data-phase") ?? null
}

afterEach(cleanup)
beforeEach(() => {
  authFetchMock.mockReset()
  authFetchMock.mockImplementation(ok)
})

describe("PhaseBar", () => {
  it("renders all seven segments and never fewer", () => {
    const { container } = render(<PhaseBar stage="identified" />)
    expect(container.querySelectorAll("[data-phase]")).toHaveLength(7)
  })

  it("lights exactly one segment, derived from the shared stage→phase map", () => {
    // One stage from each group — the mapping is the thing under test, so it is
    // asserted per group rather than trusted.
    const cases: Array<[string, string]> = [
      ["identified", "idle"],
      ["intro_requested", "active"],
      ["sequence_active", "active"],
      ["replied", "alive"],
      ["chat_scheduled", "momentum"],
      ["chat_done", "momentum"],
      ["nurture", "longgame"],
      ["ask_made", "longgame"],
      ["outcome", "won"],
      ["dormant_no_answer", "resting"],
      ["dormant_declined", "resting"],
    ]
    for (const [stage, phase] of cases) {
      const { container, unmount } = render(<PhaseBar stage={stage} />)
      expect(container.querySelectorAll('[data-active="true"]')).toHaveLength(1)
      expect(litPhase(container)).toBe(phase)
      unmount()
    }
  })

  it("falls back to the first phase for an unknown stage rather than lighting nothing", () => {
    const { container } = render(<PhaseBar stage="not_a_real_stage" />)
    expect(litPhase(container)).toBe("idle")
  })
})

describe("PipelineStepper — stage dropdown", () => {
  it("picking a stage fires the change, and the bar lights that stage's segment", async () => {
    const onChanged = vi.fn()
    const { container, rerender } = render(<PipelineStepper contact={contact} onChanged={onChanged} />)

    // Starts on 'identified' → the idle segment is lit.
    expect(litPhase(container)).toBe("idle")

    const select = screen.getByLabelText("Stage") as HTMLSelectElement
    fireEvent.change(select, { target: { value: "chat_scheduled" } })

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = authFetchMock.mock.calls[0]
    expect(url).toBe("/api/network/contacts/c1/stage")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body).stage).toBe("chat_scheduled")
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))

    // The parent owns the contact, so the bar moves when the refetched stage
    // arrives — 'chat_scheduled' belongs to momentum, two groups along.
    rerender(<PipelineStepper contact={{ ...contact, stage: "chat_scheduled" }} onChanged={onChanged} />)
    expect(litPhase(container)).toBe("momentum")
  })

  it("offers every stage, including both dormant ones, in one control", () => {
    render(<PipelineStepper contact={contact} onChanged={() => {}} />)
    const select = screen.getByLabelText("Stage") as HTMLSelectElement
    expect(select.options).toHaveLength(11)
    const values = Array.from(select.options).map((o) => o.value)
    expect(values).toContain("dormant_no_answer")
    expect(values).toContain("dormant_declined")
    // Plain-English labels, not raw keys.
    expect(Array.from(select.options).map((o) => o.text)).toContain("Keeping in touch")
  })

  it("can move backwards, not just forwards", async () => {
    render(<PipelineStepper contact={{ ...contact, stage: "chat_done" }} onChanged={() => {}} />)
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "replied" } })
    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(authFetchMock.mock.calls[0][1].body).stage).toBe("replied")
  })

  it("re-enables the control after a failed change and surfaces the error", async () => {
    authFetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 403, json: async () => ({ ok: false, error: "Forbidden" }) } as unknown as Response),
    )
    render(<PipelineStepper contact={contact} onChanged={() => {}} />)
    const select = screen.getByLabelText("Stage") as HTMLSelectElement
    fireEvent.change(select, { target: { value: "replied" } })

    await waitFor(() => expect(screen.getByText("Forbidden")).toBeTruthy())
    expect(select.disabled).toBe(false)
  })
})
