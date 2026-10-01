#!/usr/bin/env tsx
// The prospect workflow, Phase 1: stages forward and back, lost and reopened,
// consult booked, consult saved, and the three consult outcomes.
// Run: npx tsx tests/prospects/workflow.test.ts
//
// Logic only, against tests/_lib/fakeSupabase.ts. The routes check who may act
// and call lib/prospects/*, which is what is exercised here.

import { makeFakeDb, type Row } from "../_lib/fakeSupabase"
import { advanceProspectTo, advanceIfPresent, moveProspectBack } from "../../lib/prospects/stages"
import {
  CONSULT_OUTCOME_CHAIN,
  bookConsult,
  getConsult,
  markProspectLost,
  parseConsultSave,
  parseLostInput,
  parseOutcomeInput,
  recordConsultOutcome,
  reopenProspect,
  saveConsult,
} from "../../lib/prospects/workflow"
import { parseLeadSource, parseParent, LEAD_SOURCES, LEAD_SOURCE_LABEL, SERVICES } from "../../lib/prospects/model"
import { withRecordNames } from "../../lib/tasks/records"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const COACH = "coach-1"
const PKG = "11111111-2222-3333-4444-555555555555"
const STAGES = [
  ["lead_identified", "Lead Identified"], ["initial_contact", "Initial Contact"],
  ["consult_scheduled", "Consult Scheduled"], ["consult_completed", "Consult Completed"],
  ["sow_drafted", "SOW Drafted"], ["sow_sent", "SOW Sent"],
].map(([stage_key, label], i) => ({ coach_profile_id: COACH, stage_key, label, sort_order: i + 1, is_terminal: false, active: true }))

function seed(over: Row = {}, extra: Record<string, Row[]> = {}) {
  const db = makeFakeDb({
    client_profiles: [{ id: COACH, name: "Peri Ginsberg", is_coach: true }],
    coach_clients: [{
      id: "cc-1", name: "Jamie Rivera", coach_profile_id: COACH, client_profile_id: null, status: "active",
      lifecycle_status: "Prospect", prospect_status: "active", current_stage_key: null,
      source_category: "google_search", source_detail: null, referred_by_name: null, referred_by_email: null,
      invited_email: "jamie@example.com", phone: null, parent_name: null, parent_email: null, parent_phone: null,
      current_title: null, current_company: null, university: null, field_of_study: null, grad_date: null,
      target_roles: null, target_industries: null, target_locations: null,
      lost_reason: null, lost_reason_detail: null, lost_notes: null, lost_at: null,
      ...over,
    }],
    coach_pipeline_stages: [...STAGES, { coach_profile_id: COACH, stage_key: "convert_to_client", label: "Convert", sort_order: 99, is_terminal: true, active: true }],
    prospect_stage_progress: [],
    prospect_consults: [],
    coach_tasks: [],
    coach_task_events: [],
    coach_client_events: [],
    coach_delegates: [],
    coach_automation_events: [],
    coach_packages: [{ id: PKG, name: "Run the Search", coach_profile_id: COACH }],
    coach_client_engagements: [],
    ...extra,
  })
  db.onRpc("attach_package_to_engagement", (a) => {
    const id = `eng-${db.tables.coach_client_engagements.length + 1}`
    db.tables.coach_client_engagements.push({ id, coach_client_id: a.p_coach_client_id, name: "Run the Search", attached_by: a.p_coach_profile_id })
    return { data: id }
  })
  return db
}
type Db = ReturnType<typeof seed>
const prospect = (db: Db) => db.tables.coach_clients[0]
const reached = (db: Db) => db.tables.prospect_stage_progress.map((p) => p.stage_key).sort()
const events = (db: Db, type?: string) => db.tables.coach_client_events.filter((e) => !type || e.event_type === type)
const openTasks = (db: Db) => db.tables.coach_tasks.filter((t) => t.status === "open" && !t.deleted_at)
const args = { coachClientId: "cc-1", actingIds: [COACH], actor: COACH }

async function main() {
  const warn = console.warn
  console.warn = () => {}

  console.log("lead source")
  {
    ok("eight pickable sources, in the order given", LEAD_SOURCES.length === 8 && LEAD_SOURCES[0] === "friend_family" && LEAD_SOURCES[7] === "other")
    ok("labels read as written", LEAD_SOURCE_LABEL.past_client === "A past client of Peri's" && LEAD_SOURCE_LABEL.ad === "Saw an ad")
    const ref = parseLeadSource({ source_category: "friend_family", referred_by_name: " Dana Lee ", referred_by_email: "Dana@Example.com" }, null, { required: true })
    ok("a referral keeps who referred them", ref.ok && ref.value.referred_by_name === "Dana Lee" && ref.value.referred_by_email === "dana@example.com")
    const google = parseLeadSource({ source_category: "google_search", referred_by_name: "Dana" }, null, { required: true })
    ok("any other source drops a referred-by", google.ok && google.value.referred_by_name === null)
    const moved = parseLeadSource({ source_category: "ad" },
      { source_category: "past_client", referred_by_name: "Dana", referred_by_email: null }, { required: true })
    ok("changing away from a referral clears it", moved.ok && moved.value.referred_by_name === null && moved.value.referred_by_email === null)
    ok("an old value is no longer offered", !parseLeadSource({ source_category: "website" }, null, { required: true }).ok)
    const legacy = parseLeadSource({ source_category: "website", source_detail: "x" },
      { source_category: "website", referred_by_name: null, referred_by_email: null }, { required: true })
    ok("but an unchanged old value may stay on an edit", legacy.ok && legacy.value.source_category === "website")
    ok("source is required on create", !parseLeadSource({}, null, { required: true }).ok)
    ok("a bad referrer email is refused", !parseLeadSource({ source_category: "past_client", referred_by_email: "nope" }, null, { required: true }).ok)
    const parent = parseParent({ parent_name: "Pat Rivera", parent_email: "PAT@x.com", parent_phone: "" })
    ok("parent contact is optional and tidied", parent.ok && parent.value.parent_email === "pat@x.com" && parent.value.parent_phone === null)
  }

  console.log("\nstages forward and back")
  {
    const db = seed()
    const r = await advanceProspectTo(db.client, { ...args, stageKey: "consult_completed" })
    ok("advancing fills the path", r.ok && reached(db).join() === "consult_completed,consult_scheduled,initial_contact,lead_identified")
    ok("current stage is the furthest reached", prospect(db).current_stage_key === "consult_completed")
    ok("one History line per stage reached, by name", events(db, "stage_changed").length === 4
      && events(db, "stage_changed").some((e) => e.context.stage_label === "Consult Scheduled"))

    const back = await moveProspectBack(db.client, { ...args, stageKey: "initial_contact" })
    ok("moving back un-reaches the later stages", back.ok && reached(db).join() === "initial_contact,lead_identified")
    ok("and makes the target current", prospect(db).current_stage_key === "initial_contact")
    const line = events(db, "stage_moved_back")[0]
    ok("logged once, naming both stages", events(db, "stage_moved_back").length === 1
      && line.context.from_stage_label === "Consult Completed" && line.context.stage_label === "Initial Contact")
    ok("moving back to the current stage is refused", !(await moveProspectBack(db.client, { ...args, stageKey: "initial_contact" })).ok)
    ok("moving back to a stage never reached is refused", !(await moveProspectBack(db.client, { ...args, stageKey: "sow_sent" })).ok)
  }
  {
    const db = seed({ lifecycle_status: "Active", prospect_status: "won" })
    await advanceProspectTo(db.client, { ...args, stageKey: "initial_contact" })
    const r = await moveProspectBack(db.client, { ...args, stageKey: "lead_identified" })
    ok("a converted prospect cannot be moved back", !r.ok && r.status === 409)
  }
  {
    const db = seed({}, { coach_pipeline_stages: STAGES.filter((s) => s.stage_key !== "consult_scheduled") })
    const r = await advanceIfPresent(db.client, { ...args, stageKey: "consult_scheduled" })
    ok("a pipeline without the stage is left alone", r.length === 0 && reached(db).length === 0)
  }

  console.log("\nlost and reopened")
  {
    ok("a reason is required", !parseLostInput({}).ok)
    ok("Other needs its text", !parseLostInput({ lost_reason: "other" }).ok)
    const p = parseLostInput({ lost_reason: "price", lost_notes: "Budget next spring", lost_reason_detail: "ignored" })
    ok("a plain reason drops stray detail", p.ok && p.value.detail === null && p.value.notes === "Budget next spring")

    const db = seed()
    const lost = await markProspectLost(db.client, { coachClientId: "cc-1", reason: "price", detail: null, notes: "Budget next spring", actor: COACH })
    ok("marked lost with reason, notes and time", lost.ok && prospect(db).prospect_status === "lost"
      && prospect(db).lost_reason === "price" && prospect(db).lost_notes === "Budget next spring" && !!prospect(db).lost_at)
    ok("History keeps the reason", events(db, "prospect_lost")[0]?.context.reason_label === "Price")
    ok("cannot be lost twice", !(await markProspectLost(db.client, { coachClientId: "cc-1", reason: "timing", detail: null, notes: null, actor: COACH })).ok)

    const re = await reopenProspect(db.client, { coachClientId: "cc-1", actor: COACH })
    ok("reopened to active, reason cleared on the record", re.ok && prospect(db).prospect_status === "active" && prospect(db).lost_reason === null)
    ok("but kept in History", events(db, "prospect_reopened")[0]?.context.previous_reason === "price"
      && events(db, "prospect_reopened")[0]?.context.previous_notes === "Budget next spring")
    ok("only a lost prospect can be reopened", !(await reopenProspect(db.client, { coachClientId: "cc-1", actor: COACH })).ok)
  }

  console.log("\nconsult booked")
  {
    const db = seed()
    const r = await bookConsult(db.client, { ...args, day: "2026-10-09" })
    const t = openTasks(db)[0]
    ok("creates the prep task, due the day of the call", r.ok && t?.title === "Prep for consult with Jamie Rivera"
      && t.due_at === "2026-10-09T12:00:00.000Z" && t.due_has_time === false)
    ok("linked to the consult screen", t?.link === "/dashboard/coach/prospects/cc-1/consult")
    ok("records the date", (await getConsult(db.client, "cc-1")).scheduled_for === "2026-10-09")
    ok("reaches Consult Scheduled", reached(db).includes("consult_scheduled") && prospect(db).current_stage_key === "consult_scheduled")
    ok("logged", events(db, "consult_booked")[0]?.context.date === "2026-10-09")

    const again = await bookConsult(db.client, { ...args, day: "2026-10-12" })
    ok("rebooking moves the same task", again.ok && again.data.rescheduled && openTasks(db).length === 1
      && openTasks(db)[0].due_at === "2026-10-12T12:00:00.000Z")
    ok("a date is required", !(await bookConsult(db.client, { ...args, day: "" })).ok)
  }
  {
    const db = seed({ prospect_status: "lost" })
    ok("a lost prospect must be reopened first", !(await bookConsult(db.client, { ...args, day: "2026-10-09" })).ok)
  }

  console.log("\nconsult saved")
  {
    const db = seed({ target_roles: "Analyst" })
    const r = await saveConsult(db.client, { coachClientId: "cc-1", actor: COACH, body: {
      prospect: { target_roles: "Consulting analyst", parent_name: "Pat Rivera", source_category: "past_client", referred_by_name: "Dana Lee" },
      consult: { why_now: "Graduating in May", search_goal: "first_job", services: ["linkedin", "early_career_planning"], material_resume: "needs_work" },
    } })
    ok("saves record and consult fields", r.ok && prospect(db).target_roles === "Consulting analyst" && prospect(db).referred_by_name === "Dana Lee")
    const c = await getConsult(db.client, "cc-1")
    ok("consult fields saved, services in list order", c.why_now === "Graduating in May" && c.search_goal === "first_job"
      && JSON.stringify(c.services) === JSON.stringify(["early_career_planning", "linkedin"]) && c.material_resume === "needs_work")
    const snap = events(db, "consult_saved")[0]?.context
    ok("History keeps the values it replaced", snap?.previous.prospect.target_roles === "Analyst"
      && snap?.previous.prospect.source_category === "google_search" && snap?.previous.consult.why_now === null)
    ok("and which fields changed", Array.isArray(snap?.changed) && snap.changed.includes("why_now") && snap.changed.includes("target_roles"))

    const again = await saveConsult(db.client, { coachClientId: "cc-1", actor: COACH, body: { consult: { why_now: "Graduating in May" } } })
    ok("a save that changes nothing writes nothing", again.ok && again.data.changed.length === 0 && events(db, "consult_saved").length === 1)
    ok("a bad service is refused", !parseConsultSave({ consult: { services: ["yoga"] } }, {}).ok)
    ok("search goal Other keeps its text; another goal drops it",
      (() => { const p = parseConsultSave({ consult: { search_goal: "internship", search_goal_other: "x" } }, {}); return p.ok && p.value.consult.search_goal_other === null })())
    ok("the name cannot be blanked", !parseConsultSave({ prospect: { name: " " } }, {}).ok)
    ok("services list starts with Early Career Planning", SERVICES[0] === "early_career_planning")
  }

  console.log("\noutcomes")
  {
    ok("each outcome has a chain to confirm", CONSULT_OUTCOME_CHAIN.completed.length >= 4 && CONSULT_OUTCOME_CHAIN.no_show.length >= 2 && CONSULT_OUTCOME_CHAIN.not_a_fit.length >= 2)
    ok("complete needs a package or Custom", !parseOutcomeInput({ outcome: "completed" }).ok)
    ok("time logged must be whole minutes", !parseOutcomeInput({ outcome: "completed", package_id: "custom", minutes: "4.5" }).ok)
  }
  {
    const db = seed()
    await bookConsult(db.client, { ...args, day: "2026-10-09" })
    const input = parseOutcomeInput({ outcome: "completed", package_id: PKG, minutes: "45" })
    const r = input.ok ? await recordConsultOutcome(db.client, { ...args, input: input.value }) : null
    ok("consult complete runs", !!r?.ok)
    const c = await getConsult(db.client, "cc-1")
    ok("records outcome and minutes", c.outcome === "completed" && c.minutes_logged === 45)
    ok("attaches the package through the RPC, for the relationship's own coach",
      db.tables.coach_client_engagements.length === 1 && db.tables.coach_client_engagements[0].attached_by === COACH)
    ok("reaches Consult Completed", prospect(db).current_stage_key === "consult_completed")
    const prep = db.tables.coach_tasks.find((t) => t.title === "Prep for consult with Jamie Rivera")
    ok("closes the prep task", prep?.status === "done")
    ok("logged like a tick", db.tables.coach_task_events.some((e) => e.task_id === prep?.id && e.kind === "completed"))
    const sow = db.tables.coach_tasks.find((t) => t.title === "Draft SOW for Jamie Rivera")
    ok("creates Draft SOW, due tomorrow, naming the package", !!sow && sow.description === "Package: Run the Search" && !!sow.due_at)
    ok("logged with package and minutes", events(db, "consult_completed")[0]?.context.package_name === "Run the Search"
      && events(db, "consult_completed")[0]?.context.minutes === 45)
    const second = await recordConsultOutcome(db.client, { ...args, input: { outcome: "no_show" } })
    ok("a second outcome for the same call is refused", !second.ok && second.status === 409)
  }
  {
    const db = seed()
    const r = await recordConsultOutcome(db.client, { ...args, input: { outcome: "completed", minutes: null, packageChoice: { custom: true } } })
    ok("an outcome with no prep task to close still runs", r.ok)
    ok("Custom starts an empty engagement named Custom", r.ok && db.tables.coach_client_engagements[0]?.name === "Custom")
  }
  {
    const db = seed()
    const r = await recordConsultOutcome(db.client, { ...args, input: { outcome: "completed", minutes: null, packageChoice: { packageId: "99999999-2222-3333-4444-555555555555" } } })
    ok("another practice's package is refused", !r.ok && r.status === 404 && db.tables.coach_client_engagements.length === 0)
  }
  {
    const db = seed()
    await bookConsult(db.client, { ...args, day: "2026-10-09" })
    const r = await recordConsultOutcome(db.client, { ...args, input: { outcome: "no_show" } })
    ok("no-show recorded", r.ok && (await getConsult(db.client, "cc-1")).outcome === "no_show")
    ok("no-show closes the prep task too", db.tables.coach_tasks.find((t) => t.title.startsWith("Prep for consult"))?.status === "done")
    ok("creates the follow-up task", db.tables.coach_tasks.some((t) => t.title === "Follow up with Jamie Rivera after missed consult"))
    ok("logged", events(db, "consult_no_show").length === 1)
    const rebook = await bookConsult(db.client, { ...args, day: "2026-10-16" })
    ok("booking again clears the no-show for the new call", rebook.ok && (await getConsult(db.client, "cc-1")).outcome === null)
    ok("and makes a fresh prep task for it", openTasks(db).filter((t) => t.title.startsWith("Prep for consult")).length === 1
      && openTasks(db).find((t) => t.title.startsWith("Prep for consult"))?.due_at === "2026-10-16T12:00:00.000Z")
  }
  {
    const db = seed()
    await bookConsult(db.client, { ...args, day: "2026-10-09" })
    const r = await recordConsultOutcome(db.client, { ...args, input: { outcome: "not_a_fit", notes: "Wants a recruiter, not coaching" } })
    ok("not a fit marks the prospect lost with that reason", r.ok && prospect(db).prospect_status === "lost"
      && prospect(db).lost_reason === "not_a_fit" && prospect(db).lost_notes === "Wants a recruiter, not coaching")
    ok("logged as lost from the consult", events(db, "prospect_lost")[0]?.context.via === "consult")
    ok("and the consult records it", (await getConsult(db.client, "cc-1")).outcome === "not_a_fit")
    ok("not a fit closes the prep task", db.tables.coach_tasks.find((t) => t.title.startsWith("Prep for consult"))?.status === "done")
  }

  console.log("\ntasks name their prospect")
  {
    const db = seed({}, { coach_clients: [
      { id: "cc-1", name: "Jamie Rivera", lifecycle_status: "Prospect", invited_email: null },
      { id: "cc-2", name: null, lifecycle_status: "Active", invited_email: "sam@example.com" },
    ] })
    const out = await withRecordNames(db.client, [
      { client_profile_id: null, coach_client_id: "cc-1" },
      { client_profile_id: null, coach_client_id: "cc-2" },
      { client_profile_id: "p1", coach_client_id: "cc-9" },
      { client_profile_id: null, coach_client_id: null },
    ])
    ok("a prospect task carries the prospect's name and page", out[0].record?.kind === "prospect"
      && out[0].record?.name === "Jamie Rivera" && out[0].record?.href === "/dashboard/coach/prospects/cc-1")
    ok("a converted client without an account falls back to the email", out[1].record?.kind === "client"
      && out[1].record?.name === "sam@example.com" && out[1].record?.href === "/dashboard/coach/coach-clients/cc-2")
    ok("a client task keeps its profile, no record", out[2].record === null)
    ok("a task with no one has none", out[3].record === null)
  }

  console.warn = warn
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main()
