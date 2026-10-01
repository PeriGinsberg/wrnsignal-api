// The converted-client page (coach-clients/[id]) matches the client and
// prospect pages: Add Note and Add Task in the header, a Tasks section scoped
// to this relationship, and notes added through the shared panel (type +
// topic, no Action Item).

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "cc-1" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock("../../../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  }),
}))

import Page from "./page"

const RECORD = {
  id: "cc-1",
  name: "Jamie Rivera",
  invited_email: "jamie@example.com",
  phone: null,
  source_category: null,
  source_detail: null,
  phases: {},
  lifecycle_status: "Active",
  client_profile_id: null,
  last_activity_at: null,
  created_at: "2026-09-01T12:00:00Z",
  notes: [
    { id: "n1", type: "session_recap", topic: "phase", body: "Kickoff done", priority: null,
      completed_at: null, created_at: "2026-09-02T12:00:00Z", updated_at: "2026-09-02T12:00:00Z", task: null },
  ],
}

const calls: Array<{ url: string; method: string; body: any }> = []
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (url === "/api/coach/prospects/cc-1" && method === "GET") return json({ ok: true, prospect: RECORD })
    if (url === "/api/coach/prospects/cc-1/notes" && method === "POST") return json({ ok: true, note: {} }, 201)
    if (url.startsWith("/api/coach/tasks/assignees")) {
      return json({ ok: true, me: "c1", assignees: [{ id: "c1", name: "Peri Ginsberg", email: null, active: true }] })
    }
    if (url.startsWith("/api/coach/tasks?")) {
      return json({ ok: true, tasks: [{
        id: "t1", title: "Send SOW", description: null, status: "open", due_at: null, due_has_time: false,
        assignee_profile_id: "c1", client_profile_id: null, coach_client_id: "cc-1", source: "manual",
        link: null, template_id: null, created_at: "2026-09-03T12:00:00Z", completed_at: null,
      }], templates: {} })
    }
    if (url.startsWith("/api/coach/clients")) return json({ ok: true, clients: [] })
    return json({ ok: false, error: `unexpected ${method} ${url}` }, 404)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("converted-client page", () => {
  it("has Add Note and Add Task in the header", async () => {
    render(<Page />)
    await screen.findByRole("heading", { name: "Jamie Rivera" })
    expect(screen.getByRole("button", { name: "Add Note" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Add Task" })).toBeTruthy()
  })

  it("lists this relationship's tasks in a Tasks section", async () => {
    render(<Page />)
    expect(await screen.findByText("Send SOW")).toBeTruthy()
    const taskCall = calls.find((c) => c.url.startsWith("/api/coach/tasks?"))!
    expect(new URL(taskCall.url, "http://x").searchParams.get("coach_client")).toBe("cc-1")
    expect(new URL(taskCall.url, "http://x").searchParams.get("assignee")).toBe("all")
  })

  it("Add Task opens the form fixed to this client", async () => {
    render(<Page />)
    await screen.findByRole("heading", { name: "Jamie Rivera" })
    expect(screen.queryByLabelText("Title")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Add Task" }))
    expect(await screen.findByLabelText("Title")).toBeTruthy()
    // The record is fixed, named "Client", rather than an optional picker.
    expect(screen.getAllByText("Client").some((el) => el.nextElementSibling?.textContent === "Jamie Rivera")).toBe(true)
    expect(screen.queryByLabelText("Client (optional)")).toBeNull()
  })

  it("the Notes section's + Add note uses the shared panel and saves a topic", async () => {
    render(<Page />)
    await screen.findByRole("heading", { name: "Jamie Rivera" })
    fireEvent.click(screen.getByRole("button", { name: "+ Add note" }))
    expect(screen.queryByText(/Action Item/i)).toBeNull()
    fireEvent.change(screen.getByLabelText("TOPIC"), { target: { value: "deliverable" } })
    fireEvent.change(screen.getByPlaceholderText("What did you want to capture?"), { target: { value: "Resume v2 sent" } })
    fireEvent.click(screen.getByRole("button", { name: "Save note" }))
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/coach/prospects/cc-1/notes")).toBe(true))
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/coach/prospects/cc-1/notes")!
    expect(post.body).toEqual({ type: "session_recap", body: "Resume v2 sent", topic: "deliverable" })
  })

  it("shows an existing note's topic", async () => {
    render(<Page />)
    expect(await screen.findByText("Kickoff done")).toBeTruthy()
    expect(screen.getAllByText("Phase").length).toBeGreaterThan(0)
  })
})
