// Prospect workflow, Phase 1, on the screens: the Add Prospect form (new lead
// sources, Referred by, parent contact, note) and the prospect page (Lost with
// a reason, Reopen, moving back a stage, Consult booked, Open consult).

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react"

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "cc-1" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock("../../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))

import AddProspectModal from "./AddProspectModal"
import ProspectPage from "./[id]/page"

const STAGES = [
  { id: "s1", stage_key: "lead_identified", label: "Lead Identified", sort_order: 1, is_custom: false, is_terminal: false, active: true },
  { id: "s2", stage_key: "initial_contact", label: "Initial Contact", sort_order: 2, is_custom: false, is_terminal: false, active: true },
  { id: "s3", stage_key: "consult_scheduled", label: "Consult Scheduled", sort_order: 3, is_custom: false, is_terminal: false, active: true },
  { id: "s9", stage_key: "convert_to_client", label: "Convert to Client", sort_order: 9, is_custom: false, is_terminal: true, active: true },
]

function prospect(over: Record<string, unknown> = {}) {
  return {
    id: "cc-1", name: "Jamie Rivera", invited_email: "jamie@example.com", phone: null,
    source_category: "friend_family", source_detail: null, referred_by_name: "Dana Lee", referred_by_email: null,
    parent_name: "Pat Rivera", parent_email: "pat@example.com", parent_phone: null, target_industries: null,
    lost_reason: null, lost_reason_detail: null, lost_notes: null, lost_at: null,
    phases: {}, lifecycle_status: "Prospect", client_profile_id: null, current_stage_key: "consult_scheduled",
    prospect_status: "active",
    stage_progress: [
      { stage_key: "lead_identified", reached_at: "2026-09-01T12:00:00Z" },
      { stage_key: "initial_contact", reached_at: "2026-09-02T12:00:00Z" },
      { stage_key: "consult_scheduled", reached_at: "2026-09-03T12:00:00Z" },
    ],
    linkedin_url: null, current_title: null, current_company: null, location: null, education_status: null,
    university: null, field_of_study: null, grad_date: null, years_experience_approx: null, job_type: null,
    target_roles: null, target_locations: null, preferred_locations: null, timeline: null, tags: null,
    is_returning: false, last_activity_at: null, created_at: "2026-09-01T12:00:00Z", notes: [],
    ...over,
  }
}

let current: ReturnType<typeof prospect>
let calls: Array<{ url: string; method: string; body: any }>
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } })

beforeEach(() => {
  current = prospect()
  calls = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, body })
    if (url === "/api/coach/prospects" && method === "POST") return json({ ok: true, prospect: { id: "cc-new" } }, 201)
    if (url === "/api/coach/prospects/cc-1" && method === "GET") return json({ ok: true, prospect: current })
    if (url === "/api/coach/pipeline") return json({ ok: true, stages: STAGES })
    if (url === "/api/coach/prospects/cc-1/status") {
      current = { ...current, prospect_status: body.prospect_status, lost_reason: body.lost_reason ?? null }
      return json({ ok: true, prospect_status: body.prospect_status })
    }
    if (url === "/api/coach/prospects/cc-1/stage") return json({ ok: true, moved_back: true })
    if (url === "/api/coach/prospects/cc-1/consult/booked") return json({ ok: true, task_id: "t1", rescheduled: false })
    if (url.startsWith("/api/coach/tasks/assignees")) return json({ ok: true, me: "c1", assignees: [] })
    if (url.startsWith("/api/coach/tasks")) return json({ ok: true, tasks: [], templates: {} })
    return json({ ok: true, events: [], engagements: [], clients: [], packages: [] })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const sent = (url: string) => calls.filter((c) => c.url === url && c.method !== "GET")

describe("Add Prospect", () => {
  it("adds with the new source, who referred them, a parent and a note", async () => {
    const onSuccess = vi.fn()
    render(<AddProspectModal onClose={() => {}} onSuccess={onSuccess} />)
    fireEvent.change(screen.getByPlaceholderText("e.g. Jordan Smith"), { target: { value: "Jamie Rivera" } })
    fireEvent.change(screen.getByPlaceholderText("student@example.com"), { target: { value: "jamie@example.com" } })
    fireEvent.change(screen.getByLabelText("HOW DID THEY HEAR ABOUT US?"), { target: { value: "past_client" } })
    fireEvent.change(screen.getByLabelText(/REFERRED BY/), { target: { value: "Dana Lee" } })
    fireEvent.click(screen.getByRole("button", { name: "+ Add a parent or guardian" }))
    fireEvent.change(screen.getByLabelText(/PARENT \/ GUARDIAN NAME/), { target: { value: "Pat Rivera" } })
    fireEvent.change(screen.getByLabelText(/PARENT EMAIL/), { target: { value: "pat@example.com" } })
    fireEvent.change(screen.getByPlaceholderText("Anything to remember about this prospect..."), { target: { value: "Met at the info session" } })
    fireEvent.click(screen.getByRole("button", { name: "Add Prospect →" }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(sent("/api/coach/prospects")[0].body).toMatchObject({
      name: "Jamie Rivera", invited_email: "jamie@example.com", source_category: "past_client",
      referred_by_name: "Dana Lee", parent_name: "Pat Rivera", parent_email: "pat@example.com",
      initial_note: "Met at the info session",
    })
  })
  it("needs a source, and Other needs its text", () => {
    render(<AddProspectModal onClose={() => {}} onSuccess={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText("e.g. Jordan Smith"), { target: { value: "Jamie" } })
    const add = screen.getByRole("button", { name: "Add Prospect →" }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("HOW DID THEY HEAR ABOUT US?"), { target: { value: "other" } })
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("PLEASE SPECIFY"), { target: { value: "Career fair" } })
    expect(add.disabled).toBe(false)
  })
})

describe("prospect page", () => {
  it("shows the referral and parent contact", async () => {
    render(<ProspectPage />)
    expect(await screen.findByText("A friend or family member")).toBeTruthy()
    expect(screen.getByText("Dana Lee")).toBeTruthy()
    expect(screen.getByText("Pat Rivera · pat@example.com")).toBeTruthy()
  })

  it("Lost asks why, then saves the reason", async () => {
    render(<ProspectPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Lost" }))
    const dialog = screen.getByRole("dialog", { name: "Mark as lost" })
    const confirm = within(dialog).getByRole("button", { name: "Mark lost" }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText("REASON"), { target: { value: "price" } })
    fireEvent.change(within(dialog).getByLabelText(/NOTES/), { target: { value: "Budget next spring" } })
    fireEvent.click(confirm)
    await waitFor(() => expect(sent("/api/coach/prospects/cc-1/status")).toHaveLength(1))
    expect(sent("/api/coach/prospects/cc-1/status")[0].body).toEqual({
      prospect_status: "lost", lost_reason: "price", lost_reason_detail: "", lost_notes: "Budget next spring",
    })
    expect(await screen.findByRole("button", { name: "Reopen" })).toBeTruthy()
    expect(screen.getByText("Price")).toBeTruthy()
  })

  it("a lost prospect can be reopened, after a confirm", async () => {
    current = prospect({ prospect_status: "lost", lost_reason: "timing" })
    render(<ProspectPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Reopen" }))
    const dialog = screen.getByRole("dialog", { name: "Reopen prospect" })
    expect(within(dialog).getByText("Clears the lost reason on the record. History keeps it.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Reopen" }))
    await waitFor(() => expect(sent("/api/coach/prospects/cc-1/status")).toHaveLength(1))
    expect(sent("/api/coach/prospects/cc-1/status")[0].body).toEqual({ prospect_status: "active" })
  })

  it("an earlier stage moves the prospect back, after a confirm", async () => {
    render(<ProspectPage />)
    fireEvent.click(await screen.findByTitle("Move back to Initial Contact"))
    const dialog = screen.getByRole("dialog", { name: "Move back a stage" })
    expect(within(dialog).getByText("Moves the prospect back to Initial Contact.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Move back" }))
    await waitFor(() => expect(sent("/api/coach/prospects/cc-1/stage")).toHaveLength(1))
    expect(sent("/api/coach/prospects/cc-1/stage")[0].body).toEqual({ stage_key: "initial_contact", direction: "back" })
  })

  it("the current stage is not a move-back target", async () => {
    render(<ProspectPage />)
    await screen.findByTitle("Move back to Initial Contact")
    expect(screen.queryByTitle("Move back to Consult Scheduled")).toBeNull()
  })

  it("Consult booked takes the date and shows the prep task it will create", async () => {
    render(<ProspectPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Consult booked" }))
    const dialog = screen.getByRole("dialog", { name: "Consult booked" })
    expect(within(dialog).getByText(/Prep for consult with Jamie Rivera/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText("DATE OF THE CALL"), { target: { value: "2026-10-09" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm booking" }))
    await waitFor(() => expect(sent("/api/coach/prospects/cc-1/consult/booked")).toHaveLength(1))
    expect(sent("/api/coach/prospects/cc-1/consult/booked")[0].body).toEqual({ date: "2026-10-09" })
  })

  it("Open consult goes to the consult screen", async () => {
    render(<ProspectPage />)
    expect((await screen.findByRole("link", { name: "Open consult" })).getAttribute("href")).toBe("/dashboard/coach/prospects/cc-1/consult")
  })
})
