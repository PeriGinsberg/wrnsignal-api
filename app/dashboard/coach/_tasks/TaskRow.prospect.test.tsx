// A task about a prospect names the prospect, links to its page and carries a
// Prospect badge. Before, every prospect task read "No client": the row could
// only name a client profile, and a prospect has none.

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { TaskRow } from "./TaskRow"
import type { Task } from "./taskClient"

afterEach(() => cleanup())

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1", title: "Prep for consult with Jamie Rivera", description: null,
    client_profile_id: null, coach_client_id: "cc-1", assignee_profile_id: "c1", created_by_profile_id: null,
    due_at: null, due_has_time: false, status: "open", completed_at: null, source: "auto",
    template_id: null, chain_id: null, brief_id: null, decision: null, legacy_note_id: null,
    link: "/dashboard/coach/prospects/cc-1/consult", created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-01T12:00:00Z", deleted_at: null, ...over,
  } as Task
}

describe("a task about a prospect", () => {
  it("names the prospect, links to its page and shows the badge", () => {
    render(<TaskRow task={task({ record: { kind: "prospect", name: "Jamie Rivera", href: "/dashboard/coach/prospects/cc-1" } })}
      onToggleDone={() => {}} />)
    const link = screen.getByRole("link", { name: /Jamie Rivera/ })
    expect(link.getAttribute("href")).toBe("/dashboard/coach/prospects/cc-1")
    expect(screen.getByText("Prospect")).toBeTruthy()
    expect(screen.queryByText("No client")).toBeNull()
  })
  it("a converted client without an account is named, without the badge", () => {
    render(<TaskRow task={task({ record: { kind: "client", name: "Sam Lee", href: "/dashboard/coach/coach-clients/cc-2" } })}
      onToggleDone={() => {}} />)
    expect(screen.getByRole("link", { name: /Sam Lee/ }).getAttribute("href")).toBe("/dashboard/coach/coach-clients/cc-2")
    expect(screen.queryByText("Prospect")).toBeNull()
  })
  it("a client task is unchanged: profile name, client link, no badge", () => {
    render(<TaskRow task={task({ client_profile_id: "p1", record: null })} clientName="Alex Kim" onToggleDone={() => {}} />)
    expect(screen.getByRole("link", { name: /Alex Kim/ }).getAttribute("href")).toBe("/dashboard/coach/clients/p1")
    expect(screen.queryByText("Prospect")).toBeNull()
  })
  it("a task with no one still says No client", () => {
    render(<TaskRow task={task({ coach_client_id: null, record: null })} onToggleDone={() => {}} />)
    expect(screen.getByText("No client")).toBeTruthy()
  })
})
