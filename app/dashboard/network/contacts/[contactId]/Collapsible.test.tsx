// The disclosure drawer, and specifically the lock that stops it destroying
// unsaved text.
//
// This component renders {open && children}, so collapsing UNMOUNTS whatever is
// inside. For drawers holding controls that write as you go that is free. For
// one holding a composer — text that lives only in local state until a Save
// button is pressed — a collapse silently destroys work. `lockedOpen` is the
// opt-in that stops it, and these pin that it actually blocks rather than
// merely looking like it does.

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { Collapsible } from "./Collapsible"

afterEach(cleanup)

const body = () => screen.queryByTestId("drawer-body-t")
const toggle = () => screen.getByTestId("drawer-toggle-t")

function setup(props: Partial<React.ComponentProps<typeof Collapsible>> = {}) {
  return render(
    <Collapsible title="Notes" summary="2 notes" testId="t" defaultOpen {...props}>
      <textarea aria-label="composer" />
    </Collapsible>,
  )
}

describe("Collapsible — the unlocked default is unchanged", () => {
  it("opens and closes freely, and UNMOUNTS its children when closed", () => {
    setup()
    expect(body()).toBeTruthy()
    fireEvent.click(toggle())
    // Not merely hidden — gone. That is the behaviour the lock exists to guard.
    expect(body()).toBeNull()
    expect(screen.queryByLabelText("composer")).toBeNull()
    fireEvent.click(toggle())
    expect(body()).toBeTruthy()
  })

  it("still closes when locking is off, even with a lockedReason supplied", () => {
    setup({ lockedOpen: false, lockedReason: "unused" })
    fireEvent.click(toggle())
    expect(body()).toBeNull()
  })
})

describe("Collapsible — locked open", () => {
  it("REFUSES to close, so the children are never unmounted", () => {
    setup({ lockedOpen: true, lockedReason: "You've got a note that hasn't been saved." })
    fireEvent.click(toggle())

    // The whole point: the composer is still mounted, so nothing typed is lost.
    expect(body()).toBeTruthy()
    expect(screen.getByLabelText("composer")).toBeTruthy()
    expect(toggle().getAttribute("aria-expanded")).toBe("true")
  })

  it("SAYS WHY rather than swallowing the click", () => {
    // A toggle that silently does nothing is indistinguishable from a broken
    // one — the exact failure this codebase already shipped once.
    setup({ lockedOpen: true, lockedReason: "You've got a note that hasn't been saved." })
    expect(screen.queryByTestId("drawer-locked-t")).toBeNull()
    fireEvent.click(toggle())
    expect(screen.getByTestId("drawer-locked-t").textContent)
      .toContain("You've got a note that hasn't been saved.")
  })

  it("falls back to a usable sentence when no reason is given", () => {
    setup({ lockedOpen: true })
    fireEvent.click(toggle())
    expect(screen.getByTestId("drawer-locked-t").textContent).toMatch(/unsaved text/i)
  })

  it("closes once the lock is released, and drops the explanation", () => {
    const { rerender } = setup({ lockedOpen: true, lockedReason: "unsaved" })
    fireEvent.click(toggle())
    expect(body()).toBeTruthy()
    expect(screen.getByTestId("drawer-locked-t")).toBeTruthy()

    // The note gets saved: the lock lifts and the drawer behaves normally again.
    rerender(
      <Collapsible title="Notes" summary="2 notes" testId="t" defaultOpen lockedOpen={false} lockedReason="unsaved">
        <textarea aria-label="composer" />
      </Collapsible>,
    )
    fireEvent.click(toggle())
    expect(body()).toBeNull()
    expect(screen.queryByTestId("drawer-locked-t")).toBeNull()
  })
})
