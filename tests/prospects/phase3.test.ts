#!/usr/bin/env tsx
// Prospect workflow, Phase 3: time-based automation rules, and the Calendly
// webhook (book, reschedule, cancel, match by student or parent email, create
// when nothing matches).
// Run: npx tsx tests/prospects/phase3.test.ts

import { makeFakeDb, type Row } from "../_lib/fakeSupabase"
import { cancelTimersFor, fireDueTimers } from "../../lib/automation/timers"
import { drain } from "../../lib/automation/run"
import {
  dayInZone,
  handleCalendlyWebhook,
  signCalendly,
  verifyCalendlySignature,
  type CalendlyWebhook,
} from "../../lib/calendly/webhook"
import { bookConsult, getConsult, markProspectLost } from "../../lib/prospects/workflow"
import { answersSnapshot, parseBookingForm, submitBookingForm } from "../../lib/prospects/bookingForm"
import { consultBookedBody, consultBookedSubject, type ConsultBookedEmail } from "../../lib/email/sendConsultBookedEmail"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const COACH = "coach-peri"
const TZ = "America/New_York"
const CONSULT_TYPE = "https://api.calendly.com/event_types/INITIAL-CONSULT"
const DAY = 24 * 60 * 60 * 1000

// The rows 20261003_calendly_and_timers.sql seeds.
const TEMPLATE = {
  id: "tmpl-followup", key: "booking_followup_no_consult", title: "Follow up with {name}: no consult booked yet",
  description: null, default_assignee_profile_id: null, due_offset_days: 0, assign_to_lead_coach: true,
  link_template: "/dashboard/coach/prospects/{coachClientId}", active: true,
}
const RULES = [
  { id: "rule-wait", event_key: "booking_form.submitted", action: "schedule", delay_days: 3,
    fires_event_key: "booking_form.no_consult", cancel_on_event_keys: ["consult.booked", "prospect.lost"],
    template_id: null, target_template_key: null, condition: {}, active: true, sort_order: 0 },
  { id: "rule-task", event_key: "booking_form.no_consult", action: "create_task", template_id: TEMPLATE.id,
    target_template_key: null, condition: {}, active: true, sort_order: 0 },
]

function prospect(id: string, over: Row = {}): Row {
  return {
    id, coach_profile_id: COACH, client_profile_id: null, status: "active", lifecycle_status: "Prospect",
    prospect_status: "active", name: "Jamie Rivera", invited_email: "jamie@example.com",
    parent_name: null, parent_email: null, parent_phone: null, phone: null,
    lost_reason: null, lost_reason_detail: null, lost_notes: null, lost_at: null,
    invited_at: "2026-09-01T00:00:00Z", ...over,
  }
}

function seed(clients: Row[] = []) {
  return makeFakeDb({
    client_profiles: [{ id: COACH, email: "peri@workforcereadynow.com", name: "Peri Ginsberg", is_coach: true }],
    coach_clients: clients,
    coach_pipeline_stages: [
      { coach_profile_id: COACH, stage_key: "lead_identified", label: "Lead Identified", sort_order: 1, is_terminal: false, active: true },
      { coach_profile_id: COACH, stage_key: "consult_scheduled", label: "Consult Scheduled", sort_order: 3, is_terminal: false, active: true },
    ],
    prospect_stage_progress: [],
    prospect_consults: [],
    coach_client_events: [],
    coach_tasks: [],
    coach_task_events: [],
    coach_delegates: [],
    coach_task_templates: [TEMPLATE],
    coach_automation_rules: RULES,
    coach_automation_events: [],
    coach_automation_timers: [],
    calendly_event_type_actions: [{ coach_profile_id: COACH, event_type_uri: CONSULT_TYPE, action: "consult_booked", active: true }],
    calendly_webhook_deliveries: [],
  })
}
type Db = ReturnType<typeof seed>

const events = (db: Db, type: string) => db.tables.coach_client_events.filter((e) => e.event_type === type)
const openTasks = (db: Db, id: string) => db.tables.coach_tasks.filter((t) => t.coach_client_id === id && t.status === "open" && !t.deleted_at)
const pending = (db: Db) => db.tables.coach_automation_timers.filter((t) => !t.fired_at && !t.cancelled_at)

let n = 0
function booking(over: Partial<CalendlyWebhook["payload"]> = {}, start = "2026-10-09T18:00:00Z"): CalendlyWebhook {
  n++
  return {
    event: "invitee.created",
    payload: {
      uri: `https://api.calendly.com/scheduled_events/E${n}/invitees/I${n}`,
      email: "jamie@example.com", name: "Jamie Rivera",
      rescheduled: false, old_invitee: null,
      scheduled_event: { uri: `https://api.calendly.com/scheduled_events/E${n}`, name: "Initial Consult", start_time: start, event_type: CONSULT_TYPE },
      ...over,
    },
  }
}
function cancellation(of: CalendlyWebhook, over: Partial<CalendlyWebhook["payload"]> = {}): CalendlyWebhook {
  return { event: "invitee.canceled", payload: { ...of.payload, cancellation: { reason: "Something came up", canceler_type: "invitee" }, ...over } }
}
const NOW = new Date("2026-10-02T15:00:00Z")
let sent: { to: string; e: ConsultBookedEmail }[] = []
let emailFails = false
const notify = async (to: string, e: ConsultBookedEmail) => {
  if (emailFails) return { ok: false, error: "Postmark down" }
  sent.push({ to, e })
  return { ok: true }
}
const hook = (db: Db, body: CalendlyWebhook) => handleCalendlyWebhook(db.client as any, body, { now: NOW, timezone: TZ, notify })

async function main() {
  const quiet = console.warn
  console.warn = () => {}

  console.log("signatures")
  {
    const body = JSON.stringify(booking())
    const t = 1_790_000_000
    const header = signCalendly(body, "secret", t)
    ok("a correctly signed delivery is accepted", verifyCalendlySignature(body, header, "secret", t * 1000))
    ok("a different key is refused", !verifyCalendlySignature(body, header, "other", t * 1000))
    ok("a changed body is refused", !verifyCalendlySignature(body + " ", header, "secret", t * 1000))
    ok("an old signature is refused", !verifyCalendlySignature(body, header, "secret", (t + 600) * 1000))
    ok("no header is refused", !verifyCalendlySignature(body, null, "secret", t * 1000))
  }

  console.log("\ndates")
  {
    ok("an evening call in New York is that day, not the UTC one", dayInZone("2026-10-09T01:30:00Z", TZ) === "2026-10-08")
  }

  console.log("\na booking matches the student's email")
  {
    const db = seed([prospect("cc-1", { invited_email: "Jamie@Example.com" })])
    const r = await hook(db, booking())
    ok("handled as a booking", r.status === 200 && r.outcome === "booked" && r.coach_client_id === "cc-1", JSON.stringify(r))
    ok("no new prospect", db.tables.coach_clients.length === 1)
    ok("the consult date is recorded", (await getConsult(db.client as any, "cc-1")).scheduled_for === "2026-10-09")
    const t = openTasks(db, "cc-1")
    ok("Prep for consult with Jamie Rivera, due that day, assigned to the coach", t.length === 1
      && t[0].title === "Prep for consult with Jamie Rivera" && t[0].due_at.startsWith("2026-10-09") && t[0].assignee_profile_id === COACH)
    ok("reaches Consult Scheduled", db.tables.prospect_stage_progress.some((x) => x.stage_key === "consult_scheduled"))
    const h = events(db, "consult_booked")[0]
    ok("History: booked on Calendly, by SIGNAL, with the time", h?.actor_profile_id === null
      && h?.context.via === "calendly" && /Fri, Oct 9/.test(h?.context.time_label))
    ok("the delivery is logged with what it did", db.tables.calendly_webhook_deliveries[0]?.outcome === "booked"
      && db.tables.calendly_webhook_deliveries[0]?.coach_client_id === "cc-1")
  }

  console.log("\na booking matches a parent's email")
  {
    const db = seed([prospect("cc-1", { parent_email: "pat@example.com", parent_name: "Pat Rivera" })])
    const r = await hook(db, booking({ email: "PAT@example.com", name: "Pat Rivera" }))
    ok("lands on the student's record", r.outcome === "booked" && r.coach_client_id === "cc-1")
    ok("the prep task names the student", openTasks(db, "cc-1")[0]?.title === "Prep for consult with Jamie Rivera")
  }

  console.log("\nthe student's email wins over a parent match elsewhere")
  {
    const db = seed([
      prospect("cc-parent", { name: "Sibling", invited_email: "sib@example.com", parent_email: "jamie@example.com" }),
      prospect("cc-own"),
    ])
    const r = await hook(db, booking())
    ok("the person's own record", r.coach_client_id === "cc-own")
  }

  console.log("\nno record matches")
  {
    const db = seed([])
    const r = await hook(db, booking({ email: "New.Person@example.com", name: "Riley Chen", text_reminder_number: "+1 555 0100" }))
    const p = db.tables.coach_clients[0]
    ok("a prospect is created from the booking", r.outcome === "booked_new_prospect" && db.tables.coach_clients.length === 1)
    ok("with their name, email, phone and source", p.name === "Riley Chen" && p.invited_email === "new.person@example.com"
      && p.phone === "+1 555 0100" && p.source_category === "other" && p.source_detail === "Booked directly on Calendly")
    ok("in the coach's practice, as an active Prospect", p.coach_profile_id === COACH && p.lifecycle_status === "Prospect" && p.prospect_status === "active")
    ok("History: created from a Calendly booking, then booked", events(db, "prospect_created")[0]?.context.via === "calendly"
      && events(db, "consult_booked").length === 1)
    ok("and the prep task exists", openTasks(db, p.id).length === 1)
  }

  console.log("\na lost prospect who books is reopened")
  {
    const db = seed([prospect("cc-1", { prospect_status: "lost", lost_reason: "timing", lost_at: "2026-09-20T00:00:00Z" })])
    const r = await hook(db, booking())
    ok("booked", r.outcome === "booked" && db.tables.coach_clients[0].prospect_status === "active")
    ok("History has the reopen", events(db, "prospect_reopened").length === 1)
  }

  console.log("\na client (not a prospect) is left alone")
  {
    const db = seed([prospect("cc-1", { lifecycle_status: "Active" })])
    const r = await hook(db, booking())
    ok("not_a_prospect, nothing created", r.outcome === "not_a_prospect" && db.tables.coach_tasks.length === 0)
  }

  console.log("\nCalendly retries")
  {
    const db = seed([prospect("cc-1")])
    const b = booking()
    await hook(db, b)
    const again = await hook(db, b)
    ok("a second delivery of the same booking does nothing", again.outcome === "duplicate"
      && openTasks(db, "cc-1").length === 1 && events(db, "consult_booked").length === 1)
  }

  console.log("\nother event types")
  {
    const db = seed([prospect("cc-1")])
    const b = booking()
    b.payload.scheduled_event.event_type = "https://api.calendly.com/event_types/SOMETHING-ELSE"
    const r = await hook(db, b)
    ok("an unmapped meeting type is ignored", r.outcome === "ignored_event_type" && db.tables.coach_tasks.length === 0
      && db.tables.calendly_webhook_deliveries.length === 0)
  }

  console.log("\na reschedule")
  {
    const db = seed([prospect("cc-1")])
    const first = booking({}, "2026-10-07T18:00:00Z")
    await hook(db, first)
    const taskId = openTasks(db, "cc-1")[0].id
    // Calendly sends the cancel half (rescheduled: true) and the new booking.
    const half = await hook(db, cancellation(first, { rescheduled: true, new_invitee: "https://api.calendly.com/x/invitees/NEW" }))
    ok("the cancel half does nothing to the record", half.outcome === "reschedule_cancel_half"
      && (await getConsult(db.client as any, "cc-1")).scheduled_for === "2026-10-07"
      && openTasks(db, "cc-1")[0]?.title.startsWith("Prep for consult"))
    const r = await hook(db, booking({ old_invitee: first.payload.uri }, "2026-10-12T14:00:00Z"))
    const t = openTasks(db, "cc-1")
    ok("the same prep task moves to the new day", r.outcome === "rescheduled" && t.length === 1 && t[0].id === taskId
      && t[0].due_at.startsWith("2026-10-12"))
    ok("the record has the new date", (await getConsult(db.client as any, "cc-1")).scheduled_for === "2026-10-12")
    const h = events(db, "consult_booked").at(-1)
    ok("History: rescheduled from the old date to the new", h?.context.rescheduled === true
      && h?.context.from_date === "2026-10-07" && h?.context.date === "2026-10-12")
  }
  {
    const db = seed([prospect("cc-1", { invited_email: "jamie@example.com" })])
    const first = booking()
    await hook(db, first)
    const r = await hook(db, booking({ old_invitee: first.payload.uri, email: "jamie.personal@example.com" }, "2026-10-14T14:00:00Z"))
    ok("a reschedule under another email stays on the original record", r.coach_client_id === "cc-1" && db.tables.coach_clients.length === 1)
  }

  console.log("\na cancellation")
  {
    const db = seed([prospect("cc-1")])
    const b = booking()
    await hook(db, b)
    const r = await hook(db, cancellation(b))
    const t = openTasks(db, "cc-1")
    ok("handled", r.outcome === "cancelled" && r.coach_client_id === "cc-1")
    ok("the date comes off the record", (await getConsult(db.client as any, "cc-1")).scheduled_for === null)
    ok("the prep task becomes the rebook nudge, due today", t.length === 1
      && t[0].title === "Consult cancelled: follow up with Jamie Rivera to rebook" && t[0].due_at.startsWith("2026-10-02"))
    const h = events(db, "consult_cancelled")[0]
    ok("History: cancelled on Calendly, the date it was for, and why", h?.context.via === "calendly"
      && h?.context.date === "2026-10-09" && h?.context.reason === "Something came up" && h?.context.canceled_by === "invitee")
  }
  {
    const db = seed([prospect("cc-1")])
    const r = await hook(db, cancellation(booking()))
    ok("a cancellation for a booking SIGNAL never saw still finds the record by email", r.outcome === "cancelled")
  }

  console.log("\nthe coach is emailed about a new booking")
  {
    sent = []
    const db = seed([prospect("cc-1", { parent_email: "pat@example.com" })])
    const form = parseBookingForm({
      submitter: "parent", first_name: "Pat", last_name: "Rivera", email: "pat@example.com", phone: "555-0102",
      student_first_name: "Jamie", student_last_name: "Rivera", student_email: "jamie@example.com",
      situation: "new_grad", services: ["linkedin", "early_career_planning"], source_category: "friend_family",
      referred_by_name: "Dana Lee", school: "Duke", grad_year: "2027", major: "Psychology", anything_else: "No offers yet.",
    }, NOW)
    if (!form.ok) throw new Error(form.error)
    db.tables.coach_client_events.push({ coach_client_id: "cc-1", event_type: "booking_form_submitted",
      context: { answers: answersSnapshot(form.value) }, created_at: "2026-10-01T12:00:00Z" })
    await hook(db, booking({ email: "pat@example.com", name: "Pat Rivera",
      questions_and_answers: [{ question: "Anything to prepare?", answer: "Resume draft attached" }] }))
    const m = sent[0]
    ok("one email, to the coach the booking is mapped to", sent.length === 1 && m.to === "peri@workforcereadynow.com")
    ok("with the student, the time and who booked", m.e.studentName === "Jamie Rivera"
      && m.e.timeLabel === "Fri, Oct 9, 2:00 PM EDT" && m.e.bookerEmail === "pat@example.com")
    ok("and the form's answers", (m.e.form as any)?.school === "Duke" && m.e.calendlyAnswers[0]?.answer === "Resume draft attached")
    const subject = consultBookedSubject(m.e)
    const { text, html } = consultBookedBody(m.e)
    ok("subject names the student and the time", subject === "New consult booked: Jamie Rivera, Fri, Oct 9, 2:00 PM EDT", subject)
    for (const line of ["When: Fri, Oct 9, 2:00 PM EDT", "Filled in by: Parent or guardian", "Parent: Pat Rivera",
      "Student: Jamie Rivera", "Student email: jamie@example.com", "Current situation: New graduate (0-1 year)",
      "Help wanted with: Early Career Planning, LinkedIn", "Heard about us: A friend or family member",
      "Referred by: Dana Lee", "School: Duke", "Graduation year: 2027", "Major: Psychology", "Anything else: No offers yet.",
      "Anything to prepare?: Resume draft attached", "/dashboard/coach/prospects/cc-1"]) {
      ok(`the email says "${line}"`, text.includes(line))
    }
    ok("the HTML escapes what people typed", !consultBookedBody({ ...m.e, studentName: "<b>x</b>" }).html.includes("<b>x</b>") && html.includes("Open in SIGNAL"))
  }
  {
    sent = []
    const db = seed([])
    await hook(db, booking({ email: "walkin@example.com", name: "Riley Chen" }))
    const { text } = consultBookedBody(sent[0].e)
    ok("a booking straight from Calendly says so", sent.length === 1 && text.includes("booked straight from your Calendly link"))
  }
  {
    sent = []
    const db = seed([prospect("cc-1")])
    const first = booking()
    await hook(db, first)
    await hook(db, booking({ old_invitee: first.payload.uri }, "2026-10-12T14:00:00Z"))
    await hook(db, cancellation(booking()))
    ok("a reschedule or cancellation sends no new-booking email", sent.length === 1)
  }
  {
    sent = []
    emailFails = true
    const db = seed([prospect("cc-1")])
    const r = await hook(db, booking())
    emailFails = false
    ok("an email that fails does not fail the booking", r.status === 200 && r.outcome === "booked" && openTasks(db, "cc-1").length === 1)
    ok("and the delivery row says so", db.tables.calendly_webhook_deliveries[0]?.detail === "email not sent: Postmark down")
  }

  console.log("\ntime-based rules: the no-booking follow-up")
  {
    const db = seed([prospect("cc-1")])
    const parsed = parseBookingForm({
      submitter: "student", first_name: "Jamie", last_name: "Rivera", email: "jamie@example.com", phone: "555-0101",
      situation: "new_grad", source_category: "google_search",
    }, NOW)
    if (!parsed.ok) throw new Error(parsed.error)
    await submitBookingForm(db.client as any, parsed.value)
    const timers = pending(db)
    ok("a form submission leaves one 3-day timer for that prospect", timers.length === 1 && timers[0].coach_client_id === "cc-1"
      && timers[0].fires_event_key === "booking_form.no_consult")
    const due = new Date(timers[0].fire_at).getTime() - new Date(db.tables.coach_automation_events[0].occurred_at ?? db.tables.coach_automation_events[0].created_at).getTime()
    ok("three days out", Math.abs(due - 3 * DAY) < 60_000, String(due))

    ok("nothing fires before it is due", (await fireDueTimers(db.client as any, new Date())) === 0)
    const later = new Date(Date.now() + 3 * DAY + 60_000)
    ok("it fires once due", (await fireDueTimers(db.client as any, later)) === 1)
    await drain(db.client as any)
    const t = openTasks(db, "cc-1")
    ok("and creates the follow-up task for the prospect's coach", t.length === 1
      && t[0].title === "Follow up with Jamie Rivera: no consult booked yet" && t[0].assignee_profile_id === COACH)
    ok("linked to the prospect", t[0].link === "/dashboard/coach/prospects/cc-1")
    ok("a timer fires only once", (await fireDueTimers(db.client as any, later)) === 0)
  }
  {
    const db = seed([prospect("cc-1"), prospect("cc-2", { name: "Other Person", invited_email: "o@example.com" })])
    for (const id of ["cc-1", "cc-2"]) {
      db.tables.coach_automation_events.push({ id: `ev-${id}`, event_key: "booking_form.submitted", payload: { coach_client_id: id },
        client_profile_id: null, occurred_at: new Date().toISOString(), processed_at: null, claimed_at: null })
    }
    await drain(db.client as any)
    ok("two prospects, two timers", pending(db).length === 2)
    await hook(db, booking())
    ok("a Calendly booking cancels that prospect's timer only", pending(db).length === 1 && pending(db)[0].coach_client_id === "cc-2")
    ok("recording which event cancelled it", db.tables.coach_automation_timers.find((t) => t.coach_client_id === "cc-1")?.cancelled_by_event_key === "consult.booked")
    await markProspectLost(db.client as any, { coachClientId: "cc-2", reason: "timing", detail: null, notes: null, actor: COACH })
    ok("marking the other one lost cancels theirs", pending(db).length === 0)
    ok("so nothing fires", (await fireDueTimers(db.client as any, new Date(Date.now() + 4 * DAY))) === 0)
  }
  {
    const db = seed([prospect("cc-1")])
    db.tables.coach_automation_events.push({ id: "ev-1", event_key: "booking_form.submitted", payload: { coach_client_id: "cc-1" },
      client_profile_id: null, occurred_at: new Date().toISOString(), processed_at: null, claimed_at: null })
    await drain(db.client as any)
    await bookConsult(db.client as any, { coachClientId: "cc-1", actingIds: [COACH], day: "2026-10-09", actor: COACH })
    ok("the Consult booked button cancels it too", pending(db).length === 0)
  }
  {
    const db = seed([prospect("cc-1")])
    db.tables.prospect_consults.push({ coach_client_id: "cc-1", scheduled_for: "2099-01-05", services: [] })
    const parsed = parseBookingForm({
      submitter: "student", first_name: "Jamie", last_name: "Rivera", email: "jamie@example.com", phone: "555-0101",
      situation: "new_grad", source_category: "google_search",
    }, NOW)
    if (!parsed.ok) throw new Error(parsed.error)
    await submitBookingForm(db.client as any, parsed.value)
    ok("no timer when a consult is already booked", pending(db).length === 0)
  }
  {
    const db = seed([prospect("cc-1")])
    ok("an event about no one cancels nothing", (await cancelTimersFor(db.client as any, {
      id: "x", event_key: "consult.booked", payload: {}, client_profile_id: null, occurred_at: new Date().toISOString(),
    })) === 0)
  }

  console.warn = quiet
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
