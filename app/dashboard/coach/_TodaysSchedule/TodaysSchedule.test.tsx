// Coach Home's Today's schedule, compact form.
//
// Pinned: one line per client event with the name linking to the client and
// the session type beside it; Join only when there is a link; "Next up" on the
// first session not yet started; personal events hidden until "Show personal";
// Refresh and the connected account live in the menu, not under the list.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

vi.mock("@/lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))

import { TodaysSchedule } from "./TodaysSchedule"

// Naive local wall-clock, the shape Graph returns.
function local(offsetMin: number): string {
  const d = new Date(Date.now() + offsetMin * 60_000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00.0000000`
}

function ev(id: string, startMin: number, extra: Record<string, unknown>) {
  return {
    id, subject: id, start: local(startMin), end: local(startMin + 30), is_all_day: false, location: null,
    attendee_count: 2, is_online_meeting: false, online_meeting_url: null, organizer_email: null,
    session_type: null, clients: [], ...extra,
  }
}

const today = local(0).slice(0, 10)

beforeEach(() => {
  try { localStorage.clear() } catch { /* jsdom */ }
  const events = [
    ev("Earlier", -120, { clients: [{ name: "Ava Lee", href: "/dashboard/coach/clients/p-ava" }], session_type: "Resume Workshop" }),
    ev("Soon", 60, {
      clients: [{ name: "Ben Cho", href: "/dashboard/coach/clients/p-ben" }],
      session_type: "Mock Interview",
      online_meeting_url: "https://zoom.us/j/1",
    }),
    ev("Later", 180, { clients: [{ name: "Cal Diaz", href: "/dashboard/coach/clients/p-cal" }] }),
    ev("Dentist", 240, {}),
  ]
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    connection: { connected_email: "peri@example.com", connected_display_name: null, connected_at: "2026-10-01" },
    events, range: "today", range_start: today, today,
  }), { status: 200 })))
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("Today's schedule, today", () => {
  it("is one line per client session, linked, with Next up and Join", async () => {
    render(<TodaysSchedule isCalendarBetaEnabled />)
    const ben = await screen.findByRole("link", { name: "Ben Cho" })
    expect(ben.getAttribute("href")).toBe("/dashboard/coach/clients/p-ben")
    expect(screen.getByText(/Mock Interview/)).toBeTruthy()

    // Next up is the first session not started yet, not the one that ended.
    const nextUp = screen.getAllByText("Next up")
    expect(nextUp).toHaveLength(1)
    expect(nextUp[0].closest(".ts-row")?.textContent).toContain("Ben Cho")

    // Join only where there is a link.
    const joins = screen.getAllByRole("link", { name: "Join" })
    expect(joins).toHaveLength(1)
    expect(joins[0].getAttribute("href")).toBe("https://zoom.us/j/1")
  })

  it("hides personal events until Show personal is on", async () => {
    render(<TodaysSchedule isCalendarBetaEnabled />)
    await screen.findByRole("link", { name: "Ben Cho" })
    expect(screen.queryByText("Dentist")).toBeNull()
    fireEvent.click(screen.getByRole("switch", { name: /Show personal \(1\)/ }))
    expect(screen.getByText("Dentist")).toBeTruthy()
  })

  it("keeps Refresh and the connected account in the menu", async () => {
    render(<TodaysSchedule isCalendarBetaEnabled />)
    await screen.findByRole("link", { name: "Ben Cho" })
    expect(screen.queryByText("Refresh")).toBeNull()
    expect(screen.queryByText(/Connected as/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Schedule options" }))
    expect(screen.getByRole("menuitem", { name: "Refresh" })).toBeTruthy()
    expect(screen.getByText("Connected as peri@example.com")).toBeTruthy()
  })
})
