// The History timeline's wording and its actor line.
//
// The load-bearing test is the first one: every event type the server can write
// must have wording here. `account_created` shipped to production without it and
// rendered to coaches as the literal string "account_created", which is what a
// missing case looks like when the fallback is the raw type.

import { describe as suite, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { HistoryTab, LABELS, actorLabel, describe, type CoachClientEvent } from "./HistoryTab"
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

  it("calls a null actor System", () => {
    expect(actorLabel(ev({ actor_profile_id: null, actor_name: null, actor_is_system: true }))).toBe("System")
  })

  it("says nothing rather than guessing when the name could not be resolved", () => {
    expect(actorLabel(ev({ actor_name: null }))).toBeNull()
  })

  it("puts the actor on the row, beside the time", async () => {
    const events = [
      ev({ event_type: "workbook_created", actor_name: "Erin Condon", context: { title: "Session 1" } }),
      ev({ event_type: "homework_webhook_failed", actor_profile_id: null, actor_name: null, actor_is_system: true }),
    ]
    global.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, events }), { status: 200 })) as typeof fetch

    render(<HistoryTab coachClientId="cc-1" />)
    expect(await screen.findByText("Workbook created · Session 1")).toBeTruthy()
    expect(screen.getByText(/^Erin Condon · /)).toBeTruthy()
    expect(screen.getByText(/^System · /)).toBeTruthy()
  })
})
