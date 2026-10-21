// A task's description opens in full. Before, the Tasks page and Coach Home
// showed its first line cut off with "..." and there was no way to read the
// rest.

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { TaskRow } from "./TaskRow"
import { CompactRow } from "./CompactRow"
import type { Task } from "./taskClient"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

afterEach(() => cleanup())

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1", title: "Review resume", description: null,
    client_profile_id: "p1", coach_client_id: "cc-1", assignee_profile_id: "c1", created_by_profile_id: null,
    due_at: null, due_has_time: false, status: "open", completed_at: null, source: "manual",
    template_id: null, chain_id: null, brief_id: null, decision: null, legacy_note_id: null,
    link: null, created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-01T12:00:00Z", deleted_at: null, ...over,
  } as Task
}

const LONG = "Check the summary line first.\nThen the bullets under each role.\n- Quantify results"

describe("Tasks page row", () => {
  it("a multi-line description opens in full and closes again", () => {
    render(<TaskRow task={task({ description: LONG })} onToggleDone={() => {}} />)
    expect(screen.queryByText("Then the bullets under each role.")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Show the full description/ }))
    expect(screen.getByText("Then the bullets under each role.")).toBeTruthy()
    expect(screen.getByText("Quantify results")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Hide the full description/ }))
    expect(screen.queryByText("Then the bullets under each role.")).toBeNull()
  })
  it("a short one-line description has no toggle", () => {
    render(<TaskRow task={task({ description: "Quick look" })} onToggleDone={() => {}} />)
    expect(screen.getByText("Quick look")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /full description/ })).toBeNull()
  })
})

describe("Coach Home row", () => {
  it("opens the full description without opening the row", () => {
    const assign = vi.fn()
    Object.defineProperty(window, "location", { value: { assign }, writable: true })
    render(<CompactRow title="Review resume" detail="Check the summary line first." fullDetail={LONG}
      meta="" tone="plain" href="https://example.test/x" />)
    fireEvent.click(screen.getByRole("button", { name: /Show the full description/ }))
    expect(screen.getByText("Then the bullets under each role.")).toBeTruthy()
    fireEvent.click(screen.getByText("Then the bullets under each role."))
    expect(assign).not.toHaveBeenCalled()
  })
})
