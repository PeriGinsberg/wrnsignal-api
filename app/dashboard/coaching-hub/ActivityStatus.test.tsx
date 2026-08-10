// The plan activity's status, and the one action beside it.
//
// WHAT THIS REPLACED, and why the tests are shaped this way: three joined
// buttons the client pressed to set status directly. That is status rendered as
// buttons, which the design language rules out — status is a coloured dot plus
// text, never a button — and it coloured "In progress" peach, so the loudest
// thing on a plan row was a state rather than something to do.
//
// So the assertions are about the rules that are easy to break later: status
// appears ONCE per row, peach is always the forward move, and every value the
// old three-button control could set is still settable.
//
// THAT LAST ONE IS A REGRESSION TEST. An earlier draft of this component
// dropped `in_progress` from the client side — a functional loss on a UI-only
// job. "Start" is how it comes back, and the test named for it is why it cannot
// quietly disappear again.

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { ActivityStatus } from "./ActivityStatus"

afterEach(cleanup)

const view = (value: string, over: Record<string, unknown> = {}) =>
  render(<ActivityStatus value={value} busy={false} onSet={() => {}} {...over} />)

describe("status is shown once, as dot and text", () => {
  it.each([
    ["not_started", "Not started"],
    ["in_progress", "In progress"],
    ["complete", "Complete"],
  ])("%s reads %s", (value, label) => {
    view(value)
    expect(screen.getByTestId("activity-status").textContent).toBe(label)
  })

  it("falls back to Not started for an unknown value rather than rendering blank", () => {
    view("something_new")
    expect(screen.getByTestId("activity-status").textContent).toBe("Not started")
  })

  it("names the status exactly once — never twice on one row", () => {
    view("in_progress")
    expect(screen.getAllByText("In progress").length).toBe(1)
  })
})

describe("the moves available depend on where the activity is", () => {
  it("Not started offers Start and Mark complete", () => {
    view("not_started")
    expect(screen.getByTestId("activity-start")).toBeTruthy()
    expect(screen.getByTestId("activity-complete")).toBeTruthy()
    expect(screen.queryByTestId("activity-reopen")).toBeNull()
  })

  it("In progress offers Mark complete only — there is nothing to start", () => {
    view("in_progress")
    expect(screen.getByTestId("activity-complete")).toBeTruthy()
    expect(screen.queryByTestId("activity-start")).toBeNull()
    expect(screen.queryByTestId("activity-reopen")).toBeNull()
  })

  it("Complete offers Reopen only", () => {
    view("complete")
    expect(screen.getByTestId("activity-reopen")).toBeTruthy()
    expect(screen.queryByTestId("activity-complete")).toBeNull()
    expect(screen.queryByTestId("activity-start")).toBeNull()
  })

  it("an unrecognised value offers the same moves as Not started, which is what it shows", () => {
    view("something_new")
    expect(screen.getByTestId("activity-start")).toBeTruthy()
    expect(screen.getByTestId("activity-complete")).toBeTruthy()
  })

  it("peach is the rightmost action wherever it appears, so it does not shuffle", () => {
    view("not_started")
    const buttons = screen.getAllByRole("button")
    expect(buttons[buttons.length - 1]).toBe(screen.getByTestId("activity-complete"))
  })

  it("status is never a button", () => {
    view("in_progress")
    const status = screen.getByTestId("activity-status")
    expect(status.tagName).toBe("SPAN")
    expect(status.querySelector("button")).toBeNull()
  })

  it("there is no menu", () => {
    view("in_progress")
    expect(screen.queryByRole("combobox")).toBeNull()
  })
})

describe("what it writes", () => {
  it("Mark complete writes complete", () => {
    const onSet = vi.fn()
    view("in_progress", { onSet })
    fireEvent.click(screen.getByTestId("activity-complete"))
    expect(onSet).toHaveBeenCalledWith("complete")
  })

  // THE REGRESSION TEST. Every value the old three-button control could set is
  // still settable from the client side; `in_progress` was briefly dropped.
  it("Start writes in_progress", () => {
    const onSet = vi.fn()
    view("not_started", { onSet })
    fireEvent.click(screen.getByTestId("activity-start"))
    expect(onSet).toHaveBeenCalledWith("in_progress")
  })

  it("all three status values remain reachable from the client", () => {
    const written = new Set<string>()
    const onSet = (v: string) => written.add(v)
    view("not_started", { onSet })
    fireEvent.click(screen.getByTestId("activity-start"))
    fireEvent.click(screen.getByTestId("activity-complete"))
    cleanup()
    view("complete", { onSet })
    fireEvent.click(screen.getByTestId("activity-reopen"))
    expect([...written].sort()).toEqual(["complete", "in_progress", "not_started"])
  })

  it("Reopen writes not_started", () => {
    const onSet = vi.fn()
    view("complete", { onSet })
    fireEvent.click(screen.getByTestId("activity-reopen"))
    expect(onSet).toHaveBeenCalledWith("not_started")
  })

  it("says Saving… and refuses a second click while in flight", () => {
    const onSet = vi.fn()
    view("not_started", { busy: true, onSet })
    const btn = screen.getByTestId("activity-complete")
    expect(btn.textContent).toBe("Saving…")
    fireEvent.click(btn)
    expect(onSet).not.toHaveBeenCalled()
  })
})
