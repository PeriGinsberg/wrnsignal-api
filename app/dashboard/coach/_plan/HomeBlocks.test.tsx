// Coach Home's plan blocks, and My active tasks.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react"

vi.mock("../../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

import { ClientsByPhaseBlock, FollowUpsBlock } from "./HomeBlocks"
import { TaskCard } from "../_tasks/TaskCard"

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("Follow-ups due", () => {
  it("lists client tasks waiting 3 or more days, linking to the client", () => {
    render(<FollowUpsBlock error={null} items={[
      { task_id: "t1", task: "Fill in the intake", client: "Ava Lee", href: "/dashboard/coach/clients/p-a", released_at: "2026-10-05", days_waiting: 5 },
    ]} />)
    const row = screen.getByTestId("follow-up")
    expect(row.textContent).toContain("Ava Lee")
    expect(row.textContent).toContain("Fill in the intake")
    expect(row.textContent).toContain("Waiting 5 days")
    expect(row.getAttribute("href")).toBe("/dashboard/coach/clients/p-a")
  })
  it("says when there are none", () => {
    render(<FollowUpsBlock error={null} items={[]} />)
    expect(screen.getByText("No client tasks have been waiting 3 days or more.")).toBeTruthy()
  })
})

describe("Clients by phase", () => {
  const buckets = [
    { key: "ph-know", label: "Know", clients: [{ coach_client_id: "a", name: "Ava Lee", href: "/dashboard/coach/clients/p-a" }] },
    { key: "ph-build", label: "Build", clients: [
      { coach_client_id: "a", name: "Ava Lee", href: "/dashboard/coach/clients/p-a" },
      { coach_client_id: "b", name: "Ben Ortiz", href: "/dashboard/coach/clients/p-b" },
    ] },
    { key: "not_started", label: "Not started", clients: [{ coach_client_id: "c", name: "Cam Diaz", href: "/dashboard/coach/coach-clients/c" }] },
  ]
  it("shows each phase with its count", () => {
    render(<ClientsByPhaseBlock error={null} buckets={buckets} />)
    const pills = within(screen.getByRole("group", { name: "Filter clients by phase" })).getAllByRole("button")
    expect(pills.map((p) => p.textContent)).toEqual(["Know1", "Build2", "Not started1"])
    expect(screen.queryByTestId("phase-clients")).toBeNull()
  })
  it("gives each phase its own colour, and Not started grey", () => {
    render(<ClientsByPhaseBlock error={null} buckets={buckets} />)
    const pills = within(screen.getByRole("group", { name: "Filter clients by phase" })).getAllByRole("button")
    const borders = pills.map((p) => p.style.borderColor)
    expect(new Set(borders).size).toBe(3)
    expect(borders[2]).toBe("rgb(138, 148, 163)")
  })
  it("clicking a phase filters to its clients, and again clears it", () => {
    render(<ClientsByPhaseBlock error={null} buckets={buckets} />)
    fireEvent.click(screen.getByRole("button", { name: "Build2" }))
    const list = screen.getByTestId("phase-clients")
    expect(within(list).getAllByRole("link").map((l) => l.textContent)).toEqual(["Ava Lee", "Ben Ortiz"])
    expect(screen.getByRole("button", { name: "Build2" }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "Build2" }))
    expect(screen.queryByTestId("phase-clients")).toBeNull()
  })
})

describe("My active tasks", () => {
  let urls: string[]
  beforeEach(() => {
    urls = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      if (url === "/api/coach/clients") return new Response(JSON.stringify({ ok: true, clients: [] }), { status: 200 })
      const tasks = Array.from({ length: 12 }, (_, i) => ({
        id: `t${i}`, title: `Task ${i}`, description: null, status: "open", due_at: null, due_has_time: false,
        assignee_profile_id: "c1", client_profile_id: null, coach_client_id: null, source: "manual", link: null,
        template_id: null, created_at: "2026-10-01T00:00:00Z", completed_at: null,
      }))
      return new Response(JSON.stringify({ ok: true, tasks, total: 12 }), { status: 200 })
    }))
  })
  it("is every open task assigned to me, by due date, the first ten", async () => {
    render(<TaskCard order="due" />)
    expect(await screen.findByText("Task 0")).toBeTruthy()
    expect(urls).toContain("/api/coach/tasks")
    expect(screen.queryByText("Task 10")).toBeNull()
    expect(screen.getByText("View all tasks (12)")).toBeTruthy()
  })
})

describe("My active tasks, due window", () => {
  const day = 24 * 60 * 60 * 1000
  const at = (days: number) => new Date(Date.now() + days * day).toISOString()
  const task = (id: string, due_at: string | null) => ({
    id, title: id, description: null, status: "open", due_at, due_has_time: true,
    assignee_profile_id: "c1", client_profile_id: null, coach_client_id: null, source: "manual", link: null,
    template_id: null, created_at: "2026-10-01T00:00:00Z", completed_at: null,
  })
  beforeEach(() => {
    try { localStorage.clear() } catch { /* jsdom */ }
    // Twelve overdue tasks: more than the card's ten, which is what made every
    // window look the same when windows still included overdue work.
    const overdue = Array.from({ length: 12 }, (_, i) => task(`Late ${i}`, at(-(i + 1))))
    const tasks = [...overdue, task("Soon", at(3)), task("Mid", at(10)), task("Far", at(25)), task("Undated", null)]
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/coach/clients") return new Response(JSON.stringify({ ok: true, clients: [] }), { status: 200 })
      return new Response(JSON.stringify({ ok: true, tasks, total: tasks.length }), { status: 200 })
    }))
  })
  it("narrows to what is coming, and points to the overdue ones", async () => {
    render(<TaskCard order="due" />)
    expect(await screen.findByText("Late 0")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "7 days" }))
    expect(screen.getByText("Soon")).toBeTruthy()
    expect(screen.queryByText("Mid")).toBeNull()
    expect(screen.queryByText("Late 0")).toBeNull()
    expect(screen.getByText("12 overdue, shown under All")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "14 days" }))
    expect(screen.getByText("Mid")).toBeTruthy()
    expect(screen.queryByText("Far")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "30 days" }))
    expect(screen.getByText("Far")).toBeTruthy()
    expect(screen.queryByText("Undated")).toBeNull()

    fireEvent.click(screen.getByText("12 overdue, shown under All"))
    expect(screen.getByText("Late 0")).toBeTruthy()
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true")
  })
})
