// The consult screen: everything known (editable), the live fields, Save
// (the values replaced go to History, server side), and the three outcomes,
// each confirmed against the chain it runs.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react"

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "cc-1" }) }))
vi.mock("../../../../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))

import ConsultPage from "./page"
import { formFrom, isDirty, saveBody, fillName } from "./consultForm"

const PROSPECT = {
  id: "cc-1", lifecycle_status: "Prospect", prospect_status: "active",
  name: "Jamie Rivera", invited_email: "jamie@example.com", phone: null,
  parent_name: "Pat Rivera", parent_email: null, parent_phone: null,
  source_category: "past_client", source_detail: null, referred_by_name: "Dana Lee", referred_by_email: null,
  current_title: null, current_company: null, university: "Duke", field_of_study: "Psychology", grad_date: "2027-05-15",
  target_roles: "Analyst", target_industries: null, target_locations: null,
}
const CONSULT = {
  scheduled_for: "2026-10-09", why_now: null, search_goal: "first_job", search_goal_other: null, services: ["linkedin"],
  timeline_deadlines: null, timeline_start: null, timeline_season: null, tried_so_far: null,
  material_resume: null, material_linkedin: null, material_cover_letter: null,
  recommendation: null, next_steps: null, outcome: null, outcome_at: null, minutes_logged: null,
}
const CHAIN = {
  completed: ["Records the consult as complete.", "Creates the task \"Draft SOW for [name]\", due tomorrow."],
  no_show: ["Records the consult as a no-show.", "Creates the task \"Follow up with [name] after missed consult\", due tomorrow."],
  not_a_fit: ["Marks the prospect Lost, with the reason \"Not a fit\" and your notes."],
}

let consult: any
let calls: Array<{ url: string; method: string; body: any }>
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } })

beforeEach(() => {
  consult = { ...CONSULT }
  calls = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, body })
    if (url === "/api/coach/prospects/cc-1/consult" && method === "GET") {
      return json({ ok: true, prospect: PROSPECT, consult, packages: [{ id: "11111111-2222-3333-4444-555555555555", name: "Run the Search" }], outcome_chain: CHAIN })
    }
    if (url === "/api/coach/prospects/cc-1/consult" && method === "PUT") {
      consult = { ...consult, ...body.consult }
      return json({ ok: true, changed: Object.keys(body.consult).filter((k) => k === "why_now"), consult })
    }
    if (url === "/api/coach/prospects/cc-1/consult/outcome") {
      consult = { ...consult, outcome: body.outcome, minutes_logged: body.minutes ? Number(body.minutes) : null }
      return json({ ok: true, outcome: body.outcome })
    }
    return json({ ok: false, error: `unexpected ${method} ${url}` }, 404)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const puts = () => calls.filter((c) => c.method === "PUT")
const outcomes = () => calls.filter((c) => c.url.endsWith("/outcome"))

describe("consult form state", () => {
  const f = formFrom(PROSPECT as any, CONSULT as any)
  it("drops referred-by and Other's text where they do not apply", () => {
    const b = saveBody({ ...f, known: { ...f.known, source_category: "ad", source_detail: "x", referred_by_name: "Dana" } })
    expect(b.prospect.source_detail).toBeNull()
    expect(b.prospect).not.toHaveProperty("referred_by_name")
  })
  it("leaves an empty lead source out, for older prospects that never had one", () => {
    const b = saveBody({ ...f, known: { ...f.known, source_category: "" } })
    expect(b.prospect).not.toHaveProperty("source_category")
  })
  it("knows when it has changed", () => {
    expect(isDirty(f, f)).toBe(false)
    expect(isDirty({ ...f, live: { ...f.live, why_now: "Graduating" } }, f)).toBe(true)
  })
  it("fills the name into a chain step", () => {
    expect(fillName("Draft SOW for [name]", "Jamie Rivera")).toBe("Draft SOW for Jamie Rivera")
  })
})

describe("consult screen", () => {
  it("shows everything known, including Referred by, prefilled and editable", async () => {
    render(<ConsultPage />)
    expect(await screen.findByRole("heading", { name: "Consult: Jamie Rivera" })).toBeTruthy()
    expect(screen.getByText(/Booked for Fri, Oct 9, 2026/)).toBeTruthy()
    expect((screen.getByLabelText(/REFERRED BY/) as HTMLInputElement).value).toBe("Dana Lee")
    expect((screen.getByLabelText(/PARENT \/ GUARDIAN NAME/) as HTMLInputElement).value).toBe("Pat Rivera")
    expect((screen.getByLabelText("SCHOOL") as HTMLInputElement).value).toBe("Duke")
    expect((screen.getByLabelText("SEARCH GOAL") as HTMLSelectElement).value).toBe("first_job")
  })

  it("lists services with Early Career Planning first, prefilled", async () => {
    render(<ConsultPage />)
    const services = await screen.findByRole("group", { name: "SERVICES OF INTEREST" })
    const boxes = within(services).getAllByRole("checkbox") as HTMLInputElement[]
    expect(within(services).getAllByText(/./).map((n) => n.textContent)[1]).toBe("Early Career Planning")
    expect(boxes.filter((b) => b.checked)).toHaveLength(1)
  })

  it("saves only when something changed, and says so", async () => {
    render(<ConsultPage />)
    const save = await screen.findByRole("button", { name: "Save consult" }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("WHAT IS GOING ON CURRENTLY"), { target: { value: "Graduating in May" } })
    expect(screen.getByText("Unsaved changes")).toBeTruthy()
    fireEvent.click(save)
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0].body.consult.why_now).toBe("Graduating in May")
    expect(puts()[0].body.prospect.referred_by_name).toBe("Dana Lee")
    expect(await screen.findByRole("status")).toBeTruthy()
    expect(screen.getByRole("status").textContent).toMatch(/1 field updated; the earlier values are in History/)
  })

  it("Consult complete: shows the chain with the name, needs a package, posts package and minutes", async () => {
    render(<ConsultPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Consult complete" }))
    const dialog = screen.getByRole("dialog", { name: "Consult complete" })
    expect(within(dialog).getByText("Creates the task \"Draft SOW for Jamie Rivera\", due tomorrow.")).toBeTruthy()
    const confirm = within(dialog).getByRole("button", { name: "Confirm" }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    const pkg = within(dialog).getByLabelText("PACKAGE") as HTMLSelectElement
    expect(Array.from(pkg.options).map((o) => o.textContent)).toEqual(["Pick a package…", "Run the Search", "Custom"])
    fireEvent.change(pkg, { target: { value: "custom" } })
    fireEvent.change(within(dialog).getByLabelText(/TIME LOGGED/), { target: { value: "45" } })
    fireEvent.click(confirm)
    await waitFor(() => expect(outcomes()).toHaveLength(1))
    expect(outcomes()[0].body).toEqual({ outcome: "completed", package_id: "custom", minutes: "45" })
    expect(await screen.findByText(/Recorded: Consult complete/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "No-show" })).toBeNull()
  })

  it("saves unsaved notes before recording the outcome, and says it will", async () => {
    render(<ConsultPage />)
    fireEvent.change(await screen.findByLabelText("NEXT STEPS (WHAT I PROMISED AND WHEN)"), { target: { value: "Send SOW Friday" } })
    fireEvent.click(screen.getByRole("button", { name: "No-show" }))
    const dialog = screen.getByRole("dialog", { name: "No-show" })
    expect(within(dialog).getByText("Saves your unsaved consult notes first.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }))
    await waitFor(() => expect(outcomes()).toHaveLength(1))
    const order = calls.filter((c) => c.method !== "GET").map((c) => c.method)
    expect(order).toEqual(["PUT", "POST"])
  })

  it("Not a fit posts its notes", async () => {
    render(<ConsultPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Not a fit" }))
    const dialog = screen.getByRole("dialog", { name: "Not a fit" })
    fireEvent.change(within(dialog).getByLabelText(/NOTES/), { target: { value: "Wants a recruiter" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }))
    await waitFor(() => expect(outcomes()).toHaveLength(1))
    expect(outcomes()[0].body).toEqual({ outcome: "not_a_fit", notes: "Wants a recruiter" })
  })

  it("offers no outcome for a lost prospect", async () => {
    PROSPECT.prospect_status = "lost"
    try {
      render(<ConsultPage />)
      expect(await screen.findByText(/marked lost. Reopen them/)).toBeTruthy()
      expect(screen.queryByRole("button", { name: "Consult complete" })).toBeNull()
    } finally {
      PROSPECT.prospect_status = "active"
    }
  })
})
