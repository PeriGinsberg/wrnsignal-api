// The History timeline's wording and its actor line.
//
// The load-bearing test is the first one: every event type the server can write
// must have wording here. `account_created` shipped to production without it and
// rendered to coaches as the literal string "account_created", which is what a
// missing case looks like when the fallback is the raw type.

import { describe as suite, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { HistoryTab, LABELS, actorLabel, describe, stamp, type CoachClientEvent } from "./HistoryTab"
import { COACH_CLIENT_EVENT_TYPES } from "../../../../../lib/coach/clientEventTypes"

// The tab's token lookup needs a Supabase session; what it renders is the
// contract under test, so the transport is mocked.
vi.mock("../../../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))

afterEach(cleanup)

function ev(over: Partial<CoachClientEvent> = {}): CoachClientEvent {
  return {
    event_type: "workbook_created",
    actor_profile_id: "coach-1",
    actor_name: "Peri Ginsberg",
    actor_is_system: false,
    context: null,
    created_at: new Date().toISOString(),
    ...over,
  }
}

suite("every event type has wording", () => {
  it("covers the server's whole vocabulary", () => {
    const missing = COACH_CLIENT_EVENT_TYPES.filter((t) => typeof LABELS[t] !== "function")
    expect(missing, `no wording for: ${missing.join(", ")}`).toEqual([])
  })

  it("never renders a raw event type for a known one", () => {
    for (const t of COACH_CLIENT_EVENT_TYPES) {
      const line = describe(ev({ event_type: t, context: { session: 1, stage_key: "won", open_questions: 2 } }))
      expect(line, `${t} rendered as its raw type`).not.toBe(t)
      expect(line.length).toBeGreaterThan(0)
    }
  })
})

suite("the prospect workflow", () => {
  const cases: [string, Record<string, unknown> | null, string][] = [
    ["stage_changed", { stage_key: "consult_scheduled", stage_label: "Consult Scheduled" }, "Moved to stage: Consult Scheduled"],
    ["stage_moved_back", { stage_label: "Initial Contact", from_stage_label: "Consult Completed" },
      "Moved back from Consult Completed to Initial Contact"],
    ["prospect_lost", { reason: "price", reason_label: "Price", notes: "Budget next spring" }, "Marked lost (Price). Budget next spring"],
    ["prospect_lost", { reason: "other", reason_label: "Other", detail: "Moved abroad" }, "Marked lost (Other: Moved abroad)"],
    ["prospect_reopened", { previous_reason_label: "Timing" }, "Reopened (was lost: Timing)"],
    ["consult_booked", { date: "2026-10-09" }, "Consult booked for Oct 9, 2026"],
    ["consult_booked", { date: "2026-10-12", rescheduled: true }, "Consult rescheduled for Oct 12, 2026"],
    ["consult_saved", { changed: ["why_now", "services"] }, "Consult saved, 2 fields updated"],
    ["consult_completed", { package_name: "Run the Search", minutes: 45 }, "Consult complete (package: Run the Search, 45 min)"],
    ["consult_no_show", null, "Consult no-show"],
  ]
  for (const [type, context, expected] of cases) {
    it(`${type} reads as written`, () => {
      expect(describe(ev({ event_type: type, context }))).toBe(expected)
    })
  }
})

suite("the six workbook events", () => {
  const cases: [string, Record<string, unknown> | null, string][] = [
    ["workbook_created", { title: "Session 1: Foundations" }, "Workbook created · Session 1: Foundations"],
    ["workbook_shared", { title: "Session 1: Foundations" }, "Workbook shared · Session 1: Foundations"],
    ["workbook_sent_for_review", { title: "Session 1: Foundations", open_questions: 2 },
      "Workbook sent for review, 2 questions · Session 1: Foundations"],
    ["workbook_returned", { title: "Session 1: Foundations" }, "Workbook returned with comments · Session 1: Foundations"],
    ["homework_complete", { title: "Session 1: Foundations", session: 1 },
      "Session 1 homework marked complete · Session 1: Foundations"],
    ["homework_webhook_failed", { title: "Session 1: Foundations" },
      "Homework notification to GoHighLevel failed · Session 1: Foundations"],
  ]
  for (const [type, context, expected] of cases) {
    it(`${type} reads as the approved wording`, () => {
      expect(describe(ev({ event_type: type, context }))).toBe(expected)
    })
  }

  it("says one question, not 1 questions", () => {
    expect(describe(ev({ event_type: "workbook_sent_for_review", context: { open_questions: 1 } })))
      .toBe("Workbook sent for review, 1 question")
  })

  it("drops the count when there are no open questions", () => {
    expect(describe(ev({ event_type: "workbook_sent_for_review", context: { open_questions: 0 } })))
      .toBe("Workbook sent for review")
  })
})

suite("who did it", () => {
  it("names a person", () => {
    expect(actorLabel(ev({ actor_name: "Erin Condon" }))).toBe("Erin Condon")
  })

  it("calls a null actor SIGNAL", () => {
    expect(actorLabel(ev({ actor_profile_id: null, actor_name: null, actor_is_system: true }))).toBe("SIGNAL")
  })

  // An unattributed line is the one thing an audit trail must not have, so an
  // actor whose name could not be resolved still says who acted.
  it("falls back to SIGNAL rather than leaving the line unattributed", () => {
    expect(actorLabel(ev({ actor_name: null }))).toBe("SIGNAL")
  })

  it("puts the date, the time and the actor on the row", async () => {
    const events = [
      ev({ event_type: "workbook_created", actor_name: "Erin Condon", context: { title: "Session 1" } }),
      ev({ event_type: "homework_webhook_failed", actor_profile_id: null, actor_name: null, actor_is_system: true }),
    ]
    global.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, events }), { status: 200 })) as typeof fetch

    render(<HistoryTab coachClientId="cc-1" />)
    expect(await screen.findByText("Workbook created · Session 1")).toBeTruthy()
    expect(screen.getByText(/ · Erin Condon$/)).toBeTruthy()
    expect(screen.getByText(/ · SIGNAL$/)).toBeTruthy()
  })

  it("shows the newest five on load, and the rest on request", async () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      ev({ event_type: "task_created", context: { title: `Task ${i + 1}` } }))
    global.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, events }), { status: 200 })) as typeof fetch

    render(<HistoryTab coachClientId="cc-1" />)
    expect(await screen.findByText("Task created: Task 1")).toBeTruthy()
    expect(screen.getByText("Task created: Task 5")).toBeTruthy()
    expect(screen.queryByText("Task created: Task 6")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show 3 more" }))
    expect(screen.getByText("Task created: Task 8")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }))
    expect(screen.queryByText("Task created: Task 8")).toBeNull()
  })

  it("has no button when there are five or fewer", async () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      ev({ event_type: "task_created", context: { title: `Task ${i + 1}` } }))
    global.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, events }), { status: 200 })) as typeof fetch

    render(<HistoryTab coachClientId="cc-1" />)
    expect(await screen.findByText("Task created: Task 5")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /more|fewer/ })).toBeNull()
  })

  // The whole reason relative time was dropped: "3 days ago" twice cannot say
  // which came first, and an audit trail is opened to answer exactly that.
  it("shows an absolute stamp, not a relative one", () => {
    const out = stamp("2026-09-25T15:59:10.000Z")
    expect(out).toMatch(/2026/)
    expect(out).toMatch(/\d{1,2}:\d{2}/)
    expect(out).not.toMatch(/ago/)
  })
})

suite("the chain events", () => {
  it("names the task on every task line", () => {
    expect(describe(ev({ event_type: "task_created", context: { title: "Create Networking Campaign" } })))
      .toBe("Task created: Create Networking Campaign")
  })

  it("says how a review was closed", () => {
    expect(describe(ev({ event_type: "task_completed", context: { title: "Review", decision: "approve" } })))
      .toBe("Task completed: Review (approved)")
    expect(describe(ev({ event_type: "task_completed", context: { title: "Review", decision: "request_changes" } })))
      .toBe("Task completed: Review (changes requested)")
  })

  it("carries the Request Changes note onto the reopen", () => {
    expect(describe(ev({ event_type: "task_reopened", context: { title: "Build", note: "Add five fintech contacts." } })))
      .toBe("Task reopened: Build: Add five fintech contacts.")
  })

  // House rule: no em dashes anywhere in SIGNAL wording. A colon does the
  // same job and survives every font and mail client.
  it("uses a colon, never an em dash, to introduce the reason", () => {
    const line = describe(ev({ event_type: "task_reopened", context: { title: "Build", note: "Add contacts." } }))
    expect(line).not.toContain("—")
    expect(line).toBe("Task reopened: Build: Add contacts.")
  })

  it("never renders an em dash for a missing stage", () => {
    expect(describe(ev({ event_type: "stage_changed", context: {} }))).toBe("Moved to a new stage")
  })

  it("names the recipient on a client email", () => {
    expect(describe(ev({ event_type: "client_email_sent", context: { to: "marco@example.com", subject: "Your networking plan is ready" } })))
      .toBe("Email sent to marco@example.com: Your networking plan is ready")
  })
})
