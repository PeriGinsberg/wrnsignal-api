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
