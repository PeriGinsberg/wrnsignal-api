#!/usr/bin/env tsx
// Calendly session bookings on a client's plan: book, reschedule, cancel, the
// second set of a multi-session deliverable, a session with no Book task, the
// one-off prep task when nothing in the plan matches, and a session that ran.
// Run: npx tsx tests/calendly/sessions.test.ts

import { makeFakeDb, type Row } from "../_lib/fakeSupabase"
import { handleCalendlyWebhook, prepDueDay, type CalendlyWebhook } from "../../lib/calendly/webhook"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const COACH = "coach-peri"
const CC = "cc-lily"
const NOW = new Date("2026-10-07T15:00:00Z")
const T = {
  mock: "https://api.calendly.com/event_types/MOCK",
  interview: "https://api.calendly.com/event_types/INTERVIEW",
  pre: "https://api.calendly.com/event_types/PRE",
  working: "https://api.calendly.com/event_types/WORKING",
}

const task = (id: string, deliv: string, name: string, owner: string, sort_order: number, state = "upcoming"): Row =>
  ({ id, engagement_deliverable_id: deliv, name, owner, state, sort_order, assignee_profile_id: null, due_date: null,
    released_at: null, is_signoff: false, welcome_release: false })

function seed(over: { proposal?: string } = {}) {
  return makeFakeDb({
    client_profiles: [
      { id: COACH, email: "peri@workforcereadynow.com", name: "Peri Ginsberg", is_coach: true },
      { id: "prof-lily", email: "lily.login@example.com", name: "Lily Chen", is_coach: false },
    ],
    coach_clients: [{ id: CC, coach_profile_id: COACH, client_profile_id: "prof-lily", status: "active", lifecycle_status: "Active",
      name: "Lily Chen", invited_email: "lily@example.com", parent_email: null, invited_at: "2026-09-01T00:00:00Z" }],
    coach_client_engagements: [{ id: "eng-1", coach_client_id: CC, name: "Land the Job", proposal_status: over.proposal ?? "approved", attached_at: "2026-10-01" }],
    coach_client_engagement_deliverables: [
      { id: "d-mock", engagement_id: "eng-1", source_milestone_id: "m-mock", name: "Mock Interview", phase_id: null, not_needed: false, sort_order: 1 },
      { id: "d-int", engagement_id: "eng-1", source_milestone_id: "m-int", name: "Interview Sessions 1 to 3", phase_id: null, not_needed: false, sort_order: 2 },
      { id: "d-pre", engagement_id: "eng-1", source_milestone_id: "m-pre", name: "Pre-Interview Prep", phase_id: null, not_needed: false, sort_order: 3 },
    ],
    coach_client_engagement_activities: [
      task("mk1", "d-mock", "Book Mock Interview", "client", 1, "waiting_on_client"),
      task("mk2", "d-mock", "Prepare for mock interview", "coach", 2),
      task("mk3", "d-mock", "Run Mock Interview", "coach", 3),
      task("mk4", "d-mock", "Evaluate mock interview", "coach", 4),
      task("i1", "d-int", "Book Interview Session 1", "client", 1, "waiting_on_client"),
      task("i2", "d-int", "Prepare for Interview Session 1", "coach", 2),
      task("i3", "d-int", "Run Interview Session 1", "coach", 3),
      task("i4", "d-int", "Complete Session 1 homework", "client", 4),
      task("i5", "d-int", "Book Interview Session 2", "client", 5),
      task("i6", "d-int", "Prepare for Interview Session 2", "coach", 6),
      task("i7", "d-int", "Run Interview Session 2", "coach", 7),
      task("p1", "d-pre", "Prepare for pre-interview prep", "coach", 1),
      task("p2", "d-pre", "Run pre-interview prep", "coach", 2),
    ],
    coach_phases: [],
    client_phase_status: [],
    coach_tasks: [],
    coach_task_events: [],
    coach_delegates: [],
    coach_task_templates: [],
    coach_automation_rules: [],
    coach_automation_events: [],
    coach_automation_timers: [],
    coach_client_events: [],
    calendly_event_type_actions: [
      { coach_profile_id: COACH, event_type_uri: T.mock, event_type_name: "Mock Interview", action: "session_booked", milestone_id: "m-mock", active: true },
      { coach_profile_id: COACH, event_type_uri: T.interview, event_type_name: "WRN Interview Session One", action: "session_booked", milestone_id: "m-int", active: true },
      { coach_profile_id: COACH, event_type_uri: T.pre, event_type_name: "Pre Interview Prep", action: "session_booked", milestone_id: "m-pre", active: true },
      { coach_profile_id: COACH, event_type_uri: T.working, event_type_name: "WRN Working Session", action: "session_booked", milestone_id: null, active: true },
    ],
    calendly_webhook_deliveries: [],
  })
}
type Db = ReturnType<typeof seed>

let n = 0
function booking(type: string, day: string, opts: { email?: string; name?: string; old?: string } = {}): CalendlyWebhook {
  n++
  return {
    event: "invitee.created",
    payload: {
      uri: `https://api.calendly.com/scheduled_events/E${n}/invitees/I${n}`,
      email: opts.email ?? "lily@example.com", name: opts.name ?? "Lily Chen", old_invitee: opts.old ?? null,
      scheduled_event: { uri: `https://api.calendly.com/scheduled_events/E${n}`, name: "Session", start_time: `${day}T18:00:00Z`, event_type: type },
    },
  }
}
const cancelOf = (b: CalendlyWebhook, rescheduled = false): CalendlyWebhook => ({
  event: "invitee.canceled",
  payload: { ...b.payload, rescheduled, cancellation: { reason: "Conflict", canceler_type: "invitee" } },
})
const send = (db: Db, body: CalendlyWebhook) => handleCalendlyWebhook(db.client as any, body, { now: NOW, timezone: "America/New_York" })
const act = (db: Db, id: string) => db.tables.coach_client_engagement_activities.find((x) => x.id === id)!
const todoFor = (db: Db, planId: string) => db.tables.coach_tasks.find((x) => x.plan_activity_id === planId && x.status === "open")
const events = (db: Db, type: string) => db.tables.coach_client_events.filter((e) => e.event_type === type)
const delivery = (db: Db, uri: string) => db.tables.calendly_webhook_deliveries.find((d) => d.invitee_uri === uri && d.event === "invitee.created")

async function main() {
  console.log("prep due date")
  ok("three days out: the day before", prepDueDay("2026-10-10", "2026-10-07") === "2026-10-09")
  ok("tomorrow: today", prepDueDay("2026-10-08", "2026-10-07") === "2026-10-07")
  ok("today: today", prepDueDay("2026-10-07", "2026-10-07") === "2026-10-07")
  ok("already past: today", prepDueDay("2026-10-01", "2026-10-07") === "2026-10-07")

  console.log("\nbook, reschedule, cancel")
  {
    const db = seed()
    const b = booking(T.mock, "2026-10-10")
    const r = await send(db, b)
    ok("booked against the plan", r.outcome === "session_booked" && r.coach_client_id === CC, JSON.stringify(r))
    ok("Book task is Done", act(db, "mk1").state === "done")
    ok("Prepare task is Active, due the day before, assigned to the coach",
      act(db, "mk2").state === "active" && act(db, "mk2").due_date === "2026-10-09" && act(db, "mk2").assignee_profile_id === COACH)
    ok("the Run task is untouched", act(db, "mk3").state === "upcoming")
    ok("the coach's To-Do has the prep task, due the day before", todoFor(db, "mk2")?.due_at === "2026-10-09T12:00:00.000Z")
    const h = events(db, "session_booked")[0]?.context
    ok("History: session booked, matched, with both tasks", h?.matched === true && h?.book_task === "Book Mock Interview" && h?.prep_task === "Prepare for mock interview")
    ok("the delivery remembers both tasks", delivery(db, b.payload.uri)?.book_task_id === "mk1" && delivery(db, b.payload.uri)?.prep_task_id === "mk2")
    ok("Calendly's retry is a duplicate", (await send(db, b)).outcome === "duplicate")

    const half = await send(db, cancelOf(b, true))
    ok("the cancel half of a reschedule does nothing", half.outcome === "reschedule_cancel_half" && act(db, "mk2").state === "active")
    const moved = booking(T.mock, "2026-10-15", { old: b.payload.uri })
    const r2 = await send(db, moved)
    ok("rescheduled", r2.outcome === "session_rescheduled", JSON.stringify(r2))
    ok("Prepare task due the day before the new date", act(db, "mk2").due_date === "2026-10-14")
    ok("the To-Do item moved with it", todoFor(db, "mk2")?.due_at === "2026-10-14T12:00:00.000Z")
    ok("History says rescheduled", events(db, "session_booked").some((e) => e.context.rescheduled === true))

    const r3 = await send(db, cancelOf(moved))
    ok("cancelled", r3.outcome === "session_cancelled", JSON.stringify(r3))
    ok("Book task back to Waiting on client", act(db, "mk1").state === "waiting_on_client")
    ok("Prepare task back to Upcoming, no due date", act(db, "mk2").state === "upcoming" && act(db, "mk2").due_date === null)
    ok("its To-Do item is closed", !todoFor(db, "mk2"))
    const c = events(db, "session_cancelled")[0]?.context
    ok("History: cancelled, with the reason and what reopened", c?.reason === "Conflict" && c?.book_task === "Book Mock Interview" && c?.prep_task === "Prepare for mock interview")

    const again = booking(T.mock, "2026-10-20")
    ok("booking again takes the same session", (await send(db, again)).outcome === "session_booked" && act(db, "mk1").state === "done" && act(db, "mk2").due_date === "2026-10-19")
  }

  console.log("\na deliverable with several sessions")
  {
    const db = seed()
    await send(db, booking(T.interview, "2026-10-12"))
    ok("first booking: Session 1", act(db, "i1").state === "done" && act(db, "i2").state === "active" && act(db, "i2").due_date === "2026-10-11")
    const second = booking(T.interview, "2026-10-19")
    await send(db, second)
    ok("second booking: Session 2, Session 1 left as it was",
      act(db, "i5").state === "done" && act(db, "i6").state === "active" && act(db, "i6").due_date === "2026-10-18" && act(db, "i2").due_date === "2026-10-11")
    ok("the delivery names Session 2's tasks", delivery(db, second.payload.uri)?.prep_task_id === "i6")
  }

  console.log("\na session with no Book task")
  {
    const db = seed()
    const b = booking(T.pre, "2026-10-09")
    const r = await send(db, b)
    ok("Prepare task Active, due the day before", r.outcome === "session_booked" && act(db, "p1").state === "active" && act(db, "p1").due_date === "2026-10-08")
    ok("no Book task recorded", delivery(db, b.payload.uri)?.book_task_id === null)
  }

  console.log("\nno match: a one-off prep task")
  {
    const db = seed()
    const b = booking(T.working, "2026-10-08")
    const r = await send(db, b)
    const todo = db.tables.coach_tasks.find((x) => x.title === "Prepare for WRN Working Session with Lily Chen")
    ok("a one-off To-Do, due today (the session is tomorrow)", r.outcome === "session_booked_one_off" && todo?.due_at === "2026-10-07T12:00:00.000Z" && todo?.coach_client_id === CC, JSON.stringify(r))
    ok("the plan is untouched", db.tables.coach_client_engagement_activities.every((a) => a.state === "upcoming" || a.state === "waiting_on_client"))
    ok("History says it matched nothing", events(db, "session_booked")[0]?.context.matched === false)
    const moved = booking(T.working, "2026-10-16", { old: b.payload.uri })
    await send(db, moved)
    ok("reschedule moves the one-off", db.tables.coach_tasks.find((x) => x.id === todo?.id)?.due_at === "2026-10-15T12:00:00.000Z")
    await send(db, cancelOf(moved))
    ok("cancel closes the one-off", db.tables.coach_tasks.find((x) => x.id === todo?.id)?.status === "cancelled")
  }
  {
    const db = seed()
    const r = await send(db, booking(T.mock, "2026-10-10", { email: "stranger@example.com", name: "Sam Stranger" }))
    ok("an email that matches no client: a one-off with the booker's name",
      r.outcome === "session_booked_one_off" && db.tables.coach_tasks.some((x) => x.title === "Prepare for Mock Interview with Sam Stranger" && x.coach_client_id === null))
    ok("and no prospect is created", db.tables.coach_clients.length === 1)
  }
  {
    const db = seed({ proposal: "sent" })
    const r = await send(db, booking(T.mock, "2026-10-10"))
    ok("a package not yet approved: one-off, plan untouched", r.outcome === "session_booked_one_off" && act(db, "mk1").state === "waiting_on_client")
  }
  {
    const db = seed()
    await send(db, booking(T.mock, "2026-10-10"))
    const r = await send(db, booking(T.mock, "2026-10-17"))
    ok("a second booking when the only set is held: one-off", r.outcome === "session_booked_one_off")
  }

  console.log("\nfinding the client, and a session that already ran")
  {
    const db = seed()
    const r = await send(db, booking(T.mock, "2026-10-10", { email: "LILY.LOGIN@example.com" }))
    ok("found by the email they sign in with", r.outcome === "session_booked" && act(db, "mk1").state === "done")
  }
  {
    const db = seed()
    const b = booking(T.mock, "2026-10-10")
    await send(db, b)
    act(db, "mk2").state = "done"
    act(db, "mk3").state = "done"
    const r = await send(db, cancelOf(b))
    ok("cancelled after it ran: plan unchanged", r.outcome === "session_cancelled" && act(db, "mk1").state === "done" && act(db, "mk2").state === "done")
    ok("History says it had already run", events(db, "session_cancelled")[0]?.context.already_ran === true)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
