// The Plan on a client record.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react"

vi.mock("../../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))

import { PlanSection } from "./PlanSection"

const phase = (label: string, status: string, done = 0, total = 0) =>
  ({ phase_id: `ph-${label.toLowerCase()}`, label, status, tasks_done: done, tasks_total: total, ready_to_complete: false, updated_at: null })
const task = (id: string, name: string, owner: string, state: string, sort_order: number) =>
  ({ id, deliverable_id: "", name, owner, state, assignee_profile_id: "c1", due_date: null, released_at: null, sort_order, is_signoff: false })

function plan() {
  return {
    ok: true,
    phases: [phase("Know", "complete", 1, 1), phase("Build", "in_progress", 1, 3), phase("Prove", "not_started", 0, 1), phase("Search", "not_in_plan")],
    deliverables: [
      { id: "d-know", engagement_id: "e1", engagement_name: "Foundations", name: "Intake", phase_id: "ph-know", not_needed: false, sort_order: 1,
        tasks: [task("k1", "Intake call", "coach", "done", 1)] },
      { id: "d-resume", engagement_id: "e1", engagement_name: "Foundations", name: "Resume", phase_id: "ph-build", not_needed: false, sort_order: 2,
        tasks: [task("t1", "Draft resume", "coach", "done", 1), task("t2", "Review the draft", "client", "active", 2), task("t3", "Polish", "coach", "upcoming", 3)] },
      { id: "d-mock", engagement_id: "e1", engagement_name: "Foundations", name: "Mock interview", phase_id: "ph-prove", not_needed: false, sort_order: 3,
        tasks: [task("p1", "Mock round", "coach", "upcoming", 1)] },
      { id: "d-old", engagement_id: "e1", engagement_name: "Foundations", name: "Old thing", phase_id: null, not_needed: true, sort_order: 4,
        tasks: [task("o1", "Legacy step", "coach", "upcoming", 1)] },
    ],
    packages: [{ id: "e1", name: "Foundations" }],
    library: [{ id: "m-1", name: "LinkedIn Audit", phase_id: "ph-build" }],
  }
}

let posts: any[]
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } })

beforeEach(() => {
  posts = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith("/api/coach/tasks/assignees")) return json({ ok: true, me: "c1", assignees: [{ id: "c1", name: "Peri", email: null }, { id: "c2", name: "Erin", email: null }] })
    if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return json(plan()) }
    return json(plan())
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const group = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name} phase`) })

describe("Plan", () => {
  it("groups deliverables by phase, with tasks done / total", async () => {
    render(<PlanSection coachClientId="cc-1" />)
    expect(await screen.findByText("PLAN")).toBeTruthy()
    expect(group("Build").getAttribute("aria-label")).toBe("Build phase, In progress, 1 / 3 tasks")
    expect(group("Know").getAttribute("aria-label")).toBe("Know phase, Complete, 1 / 1 tasks")
    expect(screen.queryByRole("button", { name: /^Search phase/ })).toBeNull()
    expect(group("No phase")).toBeTruthy()
  })

  it("opens the phase In progress and collapses the others", async () => {
    render(<PlanSection coachClientId="cc-1" />)
    await screen.findByText("PLAN")
    expect(group("Build").getAttribute("aria-expanded")).toBe("true")
    expect(group("Know").getAttribute("aria-expanded")).toBe("false")
    expect(screen.getByText("Draft resume")).toBeTruthy()
    expect(screen.queryByText("Intake call")).toBeNull()
    fireEvent.click(group("Know"))
    expect(screen.getByText("Intake call")).toBeTruthy()
  })

  it("an Active client task reads \"Release: [task]\" and offers Release", async () => {
    render(<PlanSection coachClientId="cc-1" />)
    const row = (await screen.findByText("Release: Review the draft")).closest("[data-testid=task]") as HTMLElement
    expect(within(row).getByText("Client")).toBeTruthy()
    expect(within(row).getByTestId("task-state").textContent).toBe("Active")
    fireEvent.click(within(row).getByRole("button", { name: "Release" }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ action: "release", task_id: "t2" })
  })

  it("each task offers only what its state allows", async () => {
    render(<PlanSection coachClientId="cc-1" />)
    const done = (await screen.findByText("Draft resume")).closest("[data-testid=task]") as HTMLElement
    expect(within(done).getAllByRole("button").map((b) => b.textContent)).toContain("Undo")
    expect(within(done).queryByRole("button", { name: "Done" })).toBeNull()
    const upcoming = screen.getByText("Polish").closest("[data-testid=task]") as HTMLElement
    expect(within(upcoming).getByRole("button", { name: "Activate" })).toBeTruthy()
    expect(within(upcoming).queryByRole("button", { name: "Release" })).toBeNull()
  })

  it("a due date on an Upcoming task asks to activate it; Yes activates", async () => {
    render(<PlanSection coachClientId="cc-1" />)
    await screen.findByText("Polish")
    fireEvent.change(screen.getByLabelText("Due date for Polish"), { target: { value: "2026-10-20" } })
    const dialog = await screen.findByRole("dialog", { name: "Make this task active now?" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes" }))
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1]).toEqual({ action: "activate", task_id: "t3" })
  })

  it("No just keeps the date", async () => {
    render(<PlanSection coachClientId="cc-1" />)
    await screen.findByText("Polish")
    fireEvent.change(screen.getByLabelText("Due date for Polish"), { target: { value: "2026-10-20" } })
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "No" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(posts).toEqual([{ action: "due", task_id: "t3", due_date: "2026-10-20" }])
  })

  it("does not ask for a task that is already under way", async () => {
    render(<PlanSection coachClientId="cc-1" />)
    await screen.findByText("Polish")
    fireEvent.change(screen.getByLabelText("Due date for Review the draft"), { target: { value: "2026-10-20" } })
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("an Upcoming task in a later phase offers Activate once its phase is opened", async () => {
    render(<PlanSection coachClientId="cc-1" />)
    await screen.findByText("Polish")
    fireEvent.click(group("Prove"))
    const row = (await screen.findByText("Mock round")).closest("[data-testid=task]") as HTMLElement
    fireEvent.click(within(row).getByRole("button", { name: "Activate" }))
    await waitFor(() => expect(posts).toEqual([{ action: "activate", task_id: "p1" }]))
  })

  it("sets assignee and due date", async () => {
    render(<PlanSection coachClientId="cc-1" />)
    await screen.findByText("Polish")
    fireEvent.change(screen.getByLabelText("Assignee for Polish"), { target: { value: "c2" } })
    fireEvent.change(screen.getByLabelText("Due date for Polish"), { target: { value: "2026-10-20" } })
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts).toEqual([
      { action: "assign", task_id: "t3", assignee: "c2" },
      { action: "due", task_id: "t3", due_date: "2026-10-20" },
    ])
  })

  it("reorders, adds a one-off task, and asks before removing", async () => {
    render(<PlanSection coachClientId="cc-1" />)
    await screen.findByText("Polish")
    fireEvent.click(screen.getByRole("button", { name: "Move Polish up" }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ action: "reorder", deliverable_id: "d-resume", task_ids: ["t1", "t3", "t2"] })

    fireEvent.change(screen.getByLabelText("New task in Resume"), { target: { value: "Extra round" } })
    fireEvent.change(within(screen.getByText("Resume").closest("[data-testid=deliverable]") as HTMLElement).getByLabelText("Task type"), { target: { value: "client" } })
    fireEvent.click(within(screen.getByText("Resume").closest("[data-testid=deliverable]") as HTMLElement).getByRole("button", { name: "+ Add task" }))
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1]).toEqual({ action: "add_task", deliverable_id: "d-resume", name: "Extra round", type: "client" })

    fireEvent.click(screen.getByRole("button", { name: "Remove Polish" }))
    expect(screen.getByRole("dialog").textContent).toContain('Remove "Polish" from this client\'s plan?')
    expect(posts).toHaveLength(2)
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }))
    await waitFor(() => expect(posts).toHaveLength(3))
    expect(posts[2]).toEqual({ action: "remove_task", task_id: "t3" })
  })

  it("a Not needed deliverable is greyed, locked, and can be restored", async () => {
    render(<PlanSection coachClientId="cc-1" />)
    await screen.findByText("PLAN")
    fireEvent.click(group("No phase"))
    const block = screen.getByText("Old thing").closest("[data-testid=deliverable]") as HTMLElement
    expect(block.style.opacity).toBe("0.55")
    expect(within(block).queryByRole("button", { name: "Activate" })).toBeNull()
    fireEvent.click(within(block).getByRole("button", { name: "Restore" }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ action: "deliverable_restore", deliverable_id: "d-old" })
  })

  it("adds a deliverable from the library", async () => {
    render(<PlanSection coachClientId="cc-1" />)
    await screen.findByText("PLAN")
    fireEvent.change(screen.getByLabelText("Deliverable to add"), { target: { value: "m-1" } })
    fireEvent.click(screen.getByRole("button", { name: "+ Add deliverable" }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ action: "add_deliverable", engagement_id: "e1", milestone_id: "m-1" })
  })

  it("tells the stepper when something changed", async () => {
    const onChanged = vi.fn()
    render(<PlanSection coachClientId="cc-1" onChanged={onChanged} />)
    fireEvent.click(within((await screen.findByText("Polish")).closest("[data-testid=task]") as HTMLElement).getByRole("button", { name: "Activate" }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })
})
