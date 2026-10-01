#!/usr/bin/env tsx
// The public consult booking form (prospect workflow, Phase 2).
// Run: npx tsx tests/prospects/bookingForm.test.ts

import { makeFakeDb, type Row } from "../_lib/fakeSupabase"
import {
  calendlyRedirect,
  gradYearToDate,
  parseBookingForm,
  submitBookingForm,
  type BookingInput,
} from "../../lib/prospects/bookingForm"
import { isHoneypotHit, isTooFast, underLimit } from "../../lib/prospects/bookingSpam"
import { getConsult } from "../../lib/prospects/workflow"
import { lostReasonText } from "../../lib/prospects/model"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const PERI = "coach-peri"
const NOW = new Date("2026-10-02T12:00:00Z")

function seed(clients: Row[] = []) {
  return makeFakeDb({
    client_profiles: [{ id: PERI, email: "peri@workforcereadynow.com", name: "Peri Ginsberg", is_coach: true }],
    coach_clients: clients,
    coach_pipeline_stages: [{ coach_profile_id: PERI, stage_key: "lead_identified", label: "Lead Identified", sort_order: 1, is_terminal: false, active: true }],
    prospect_stage_progress: [],
    prospect_consults: [],
    coach_client_events: [],
    coach_tasks: [],
    coach_task_events: [],
  })
}

const student = {
  submitter: "student", first_name: "Jamie", last_name: "Rivera", email: "Jamie@Example.com", phone: "555-0101",
  situation: "new_grad", services: ["linkedin", "early_career_planning"],
  source_category: "past_client", referred_by_name: "Dana Lee", referred_by_email: "dana@example.com",
  school: "Duke", grad_year: "2027", major: "Psychology", anything_else: "Graduating in May, no offers yet.",
}
const parentBody = {
  submitter: "parent", first_name: "Pat", last_name: "Rivera", email: "pat@example.com", phone: "555-0102",
  student_first_name: "Jamie", student_last_name: "Rivera", student_email: "jamie@example.com",
  situation: "internship", source_category: "google_search",
}

function parsed(body: Record<string, unknown>): BookingInput {
  const p = parseBookingForm(body, NOW)
  if (!p.ok) throw new Error(p.error)
  return p.value
}
const events = (db: ReturnType<typeof seed>, type: string) => db.tables.coach_client_events.filter((e) => e.event_type === type)

async function main() {
  const warn = console.warn
  console.warn = () => {}

  console.log("validation")
  {
    ok("a student submission parses, email tidied", parsed(student).email === "jamie@example.com")
    ok("who is filling it in is required", !parseBookingForm({ ...student, submitter: "" }, NOW).ok)
    for (const k of ["first_name", "last_name", "phone", "email"]) {
      ok(`${k} is required`, !parseBookingForm({ ...student, [k]: "" }, NOW).ok)
    }
    ok("a bad email is refused", !parseBookingForm({ ...student, email: "nope" }, NOW).ok)
    ok("a parent must give the student's name and email",
      !parseBookingForm({ ...parentBody, student_email: "" }, NOW).ok && !parseBookingForm({ ...parentBody, student_first_name: "" }, NOW).ok)
    ok("the student's phone is optional", parseBookingForm(parentBody, NOW).ok)
    ok("a parent cannot give their own email as the student's", !parseBookingForm({ ...parentBody, student_email: "pat@example.com" }, NOW).ok)
    ok("situation Other needs its text", !parseBookingForm({ ...student, situation: "other" }, NOW).ok
      && parseBookingForm({ ...student, situation: "other", situation_other: "Career change at 40" }, NOW).ok)
    ok("source Other needs its text", !parseBookingForm({ ...student, source_category: "other" }, NOW).ok)
    ok("an old source is not offered", !parseBookingForm({ ...student, source_category: "website" }, NOW).ok)
    ok("Referred by is kept for a referral source", parsed(student).referred_by_name === "Dana Lee")
    ok("and dropped for any other", parsed({ ...student, source_category: "ad" }).referred_by_name === null)
    ok("services come back in list order, Early Career Planning first",
      JSON.stringify(parsed(student).services) === JSON.stringify(["early_career_planning", "linkedin"]))
    ok("graduation year must be a sensible year", !parseBookingForm({ ...student, grad_year: "1850" }, NOW).ok)
    ok("a graduation year becomes May of that year", gradYearToDate(2027) === "2027-05-01")
  }

  console.log("\nspam checks")
  {
    ok("the hidden field filled means a bot", isHoneypotHit({ website: "http://spam" }) && !isHoneypotHit({ website: "" }))
    ok("under 2.5s, or no timing, is too fast", isTooFast({ elapsed_ms: 900 }) && isTooFast({}) && !isTooFast({ elapsed_ms: 9000 }))
    const store = new Map<string, number[]>()
    const t = 1_000_000
    ok("five per window are allowed", [1, 2, 3, 4, 5].every((i) => underLimit(store, "1.2.3.4", 5, 600_000, t + i)))
    ok("the sixth is refused", !underLimit(store, "1.2.3.4", 5, 600_000, t + 6))
    ok("and allowed again once the window has passed", underLimit(store, "1.2.3.4", 5, 600_000, t + 700_000))
  }

  console.log("\na student books")
  {
    const db = seed()
    const r = await submitBookingForm(db.client, parsed(student))
    const p = db.tables.coach_clients[0]
    ok("creates one prospect in Peri's practice", r.ok && r.created && db.tables.coach_clients.length === 1 && p.coach_profile_id === PERI)
    ok("filed as a Prospect, active", p.lifecycle_status === "Prospect" && p.prospect_status === "active" && p.status === "active")
    ok("under the student's name and email", p.name === "Jamie Rivera" && p.invited_email === "jamie@example.com" && p.phone === "555-0101")
    ok("with source, referral, school, year and major", p.source_category === "past_client" && p.referred_by_name === "Dana Lee"
      && p.university === "Duke" && p.grad_date === "2027-05-01" && p.field_of_study === "Psychology")
    ok("no parent contact", p.parent_name === null && p.parent_email === null)
    ok("reaches Lead Identified", db.tables.prospect_stage_progress.some((x) => x.stage_key === "lead_identified"))
    const c = await getConsult(db.client, p.id)
    ok("prefills the consult: goal, services, notes", c.search_goal === "first_job"
      && JSON.stringify(c.services) === JSON.stringify(["early_career_planning", "linkedin"])
      && c.why_now === "From the booking form: Graduating in May, no offers yet.")
    const snap = events(db, "booking_form_submitted")[0]?.context
    ok("History keeps every answer as given", snap?.submitted_by === "student" && snap?.answers.grad_year === 2027
      && snap?.answers.situation_label === "New graduate (0-1 year)" && snap?.matched_existing === false)
    ok("and logs the prospect's creation, by SIGNAL", events(db, "prospect_created")[0]?.actor_profile_id === null
      && events(db, "prospect_created")[0]?.context.via === "booking_form")
    ok("sends them to Calendly with their name and email", r.ok && r.redirect ===
      "https://calendly.com/peri-workforcereadynow/30min?name=Jamie+Rivera&email=jamie%40example.com")
  }

  console.log("\na parent books")
  {
    const db = seed()
    const r = await submitBookingForm(db.client, parsed(parentBody))
    const p = db.tables.coach_clients[0]
    ok("the record is the student's", r.ok && p.name === "Jamie Rivera" && p.invited_email === "jamie@example.com")
    ok("the parent's contact is kept", p.parent_name === "Pat Rivera" && p.parent_email === "pat@example.com" && p.parent_phone === "555-0102")
    ok("the parent's phone is not the student's", p.phone === null)
    const snap = events(db, "booking_form_submitted")[0]?.context
    ok("History says a parent submitted it", snap?.submitted_by === "parent" && snap?.submitter_name === "Pat Rivera")
    ok("Calendly is prefilled for the parent, who books the call",
      calendlyRedirect(parsed(parentBody)).includes("name=Pat+Rivera") && calendlyRedirect(parsed(parentBody)).includes("email=pat%40example.com"))
  }

  console.log("\nthe student's email already exists")
  {
    const db = seed([{
      id: "cc-old", coach_profile_id: PERI, status: "active", lifecycle_status: "Prospect", prospect_status: "lost",
      name: "Jamie R.", invited_email: "jamie@example.com", phone: null, parent_name: null, parent_email: null, parent_phone: null,
      source_category: "friend_family", source_detail: null, referred_by_name: "Aunt May", referred_by_email: null,
      university: null, field_of_study: "Economics", grad_date: null,
      lost_reason: "timing", lost_reason_detail: null, lost_notes: null, lost_at: "2026-09-01T00:00:00Z",
    }])
    const r = await submitBookingForm(db.client, parsed(student))
    const p = db.tables.coach_clients[0]
    ok("updates that record, no new one", r.ok && !r.created && r.coach_client_id === "cc-old" && db.tables.coach_clients.length === 1)
    ok("fills blanks", p.phone === "555-0101" && p.university === "Duke" && p.grad_date === "2027-05-01")
    ok("never overwrites what the coach entered", p.name === "Jamie R." && p.field_of_study === "Economics"
      && p.source_category === "friend_family" && p.referred_by_name === "Aunt May")
    ok("a lost prospect who books again is reopened", r.ok && r.reopened && p.prospect_status === "active")
    ok("History marks it as an update", events(db, "booking_form_submitted")[0]?.context.matched_existing === true)
  }
  {
    const db = seed()
    const r = await submitBookingForm(db.client, parsed(student), { coachEmail: "nobody@example.com" })
    ok("with no intake coach, nothing is saved and the person is told", !r.ok && db.tables.coach_clients.length === 0)
  }

  console.log("\nlost reason on the list")
  {
    ok("a reason reads as its label", lostReasonText({ lost_reason: "chose_other" }) === "Chose another option")
    ok("Other reads with its text", lostReasonText({ lost_reason: "other", lost_reason_detail: "Moved abroad" }) === "Other: Moved abroad")
    ok("no reason, nothing shown", lostReasonText({ lost_reason: null }) === null)
  }

  console.warn = warn
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main()
