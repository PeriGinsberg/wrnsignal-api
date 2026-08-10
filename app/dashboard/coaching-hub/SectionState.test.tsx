// The four states every Coaching Hub section goes through.
//
// This component exists because three sections carried their own copy of the
// same block, so the thing most worth pinning is the PRECEDENCE between states.
// A section that fails while refreshing was previously capable of showing
// "Loading…" forever, because each copy tested `loading` first.

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { SectionState } from "./SectionState"

afterEach(cleanup)

const view = (over: Record<string, unknown> = {}) =>
  render(
    <SectionState
      loading={false}
      error={null}
      isEmpty={false}
      emptyText="Nothing here yet."
      onRetry={() => {}}
      {...over}
    >
      <p>the content</p>
    </SectionState>,
  )

describe("SectionState", () => {
  it("shows the content when there is content", () => {
    view()
    expect(screen.getByText("the content")).toBeTruthy()
  })

  it("shows a spinner line while loading", () => {
    view({ loading: true })
    expect(screen.getByTestId("section-loading")).toBeTruthy()
    expect(screen.queryByText("the content")).toBeNull()
  })

  it("shows the section's own empty sentence", () => {
    view({ isEmpty: true })
    expect(screen.getByTestId("section-empty").textContent).toBe("Nothing here yet.")
    expect(screen.queryByText("the content")).toBeNull()
  })

  it("shows the error and a retry", () => {
    const onRetry = vi.fn()
    view({ error: "Couldn't load your plan (500)", onRetry })
    expect(screen.getByText(/Couldn't load your plan/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  // PRECEDENCE. Error wins over loading: a section refreshing after a failure
  // must show the failure, not a spinner that resolves to nothing.
  it("prefers the error over the spinner when both are set", () => {
    view({ loading: true, error: "boom" })
    expect(screen.getByTestId("section-error")).toBeTruthy()
    expect(screen.queryByTestId("section-loading")).toBeNull()
  })

  it("prefers the error over the empty state", () => {
    view({ isEmpty: true, error: "boom" })
    expect(screen.getByTestId("section-error")).toBeTruthy()
    expect(screen.queryByTestId("section-empty")).toBeNull()
  })

  it("prefers the spinner over the empty state — empty is not yet known", () => {
    view({ loading: true, isEmpty: true })
    expect(screen.getByTestId("section-loading")).toBeTruthy()
    expect(screen.queryByTestId("section-empty")).toBeNull()
  })
})
