#!/usr/bin/env tsx
// Task details on the plan: the field's rules, editing on a client's plan task
// (History line, no-op when unchanged, too long refused), a one-off task with
// details, copying from the library, and the To-Do item showing its plan
// task's details.
// Run: npx tsx tests/plan/details.test.ts

import { makeFakeDb } from "../_lib/fakeSupabase"
import { DETAILS_MAX, normalizeDetails } from "../../lib/plan/model"
import { addDeliverableFromLibrary, addTask, getPlan, updateTaskDetails } from "../../lib/plan/service"
import { withPlanDetails } from "../../lib/plan/todo"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const COACH = "coach-1"
const CC = "cc-1"

function seed() {
  return makeFakeDb({
    coach_clients: [{ id: CC, coach_profile_id: COACH, name: "Lily Chen", client_profile_id: "prof-lily", status: "active" }],
    client_profiles: [{ id: COACH, is_coach: true, name: "Peri", email: "peri@example.com" }],
    coach_client_engagements: [{ id: "eng-1", coach_client_id: CC, name: "Land the Job", proposal_status: "approved", attached_at: "2026-10-01" }],
    coach_client_engagement_deliverables: [{ id: "d-1", engagement_id: "eng-1", name: "Mock Interview", phase_id: null, not_needed: false, sort_order: 1 }],
    coach_client_engagement_activities: [
      { id: "t1", engagement_deliverable_id: "d-1", name: "Book Mock Interview", owner: "client", state: "waiting_on_client", sort_order: 1,
        assignee_profile_id: COACH, due_date: null, released_at: "2026-10-02", is_signoff: false, welcome_release: false, details: null },
      { id: "t2", engagement_deliverable_id: "d-1", name: "Prepare for mock interview", owner: "coach", state: "active", sort_order: 2,
        assignee_profile_id: COACH, due_date: null, released_at: null, is_signoff: false, welcome_release: false, details: "Review the job posting" },
    ],
    coach_milestones: [{ id: "m-lib", coach_profile_id: COACH, name: "Resume Workshop", fee_cents: 0, category: null, time_estimate_days: null, phase_id: null }],
    coach_milestone_activities: [
      { id: "la1", milestone_id: "m-lib", name: "Book Resume Workshop", owner: "client", sort_order: 1, details: "- Pick a 60 minute slot\n- Bring your current resume" },
      { id: "la2", milestone_id: "m-lib", name: "Run Resume Workshop", owner: "coach", sort_order: 2, details: null },
    ],
    coach_tasks: [
      { id: "todo-1", title: "Prepare for mock interview", plan_activity_id: "t2", status: "open" },
      { id: "todo-2", title: "Something else", plan_activity_id: null, status: "open" },
    ],
    coach_phases: [],
    client_phase_status: [],
    coach_client_events: [],
  })
}
const act = (db: ReturnType<typeof seed>, id: string) => db.tables.coach_client_engagement_activities.find((x) => x.id === id)!

async function main() {
  console.log("the field")
  ok("trimmed", (normalizeDetails("  - one\r\n- two  ") as any).value === "- one\n- two")
  ok("empty is no details", (normalizeDetails("   ") as any).value === null && (normalizeDetails(null) as any).value === null)
  ok("over the limit is refused", !normalizeDetails("x".repeat(DETAILS_MAX + 1)).ok)
  ok("not text is refused", !normalizeDetails(42).ok)

  console.log("\nediting a client's plan task")
  {
    const db = seed()
    const r = await updateTaskDetails(db.client as any, { coachClientId: CC, taskId: "t1", details: "- Use the Calendly link\n- Pick a weekday", actor: COACH })
    ok("saved", r.ok && act(db, "t1").details === "- Use the Calendly link\n- Pick a weekday")
    const h = db.tables.coach_client_events.filter((e) => e.event_type === "plan_changed" && e.context.action === "task_details")
    ok("History: details updated, by the coach", h.length === 1 && h[0].context.task === "Book Mock Interview" && h[0].actor_profile_id === COACH)
    await updateTaskDetails(db.client as any, { coachClientId: CC, taskId: "t1", details: "  - Use the Calendly link\n- Pick a weekday ", actor: COACH })
    ok("saving the same text again logs nothing", db.tables.coach_client_events.filter((e) => e.context?.action === "task_details").length === 1)
    await updateTaskDetails(db.client as any, { coachClientId: CC, taskId: "t2", details: "", actor: COACH })
    ok("clearing sets no details", act(db, "t2").details === null)
    const long = await updateTaskDetails(db.client as any, { coachClientId: CC, taskId: "t1", details: "x".repeat(DETAILS_MAX + 1), actor: COACH })
    ok("too long is refused and nothing changes", !long.ok && act(db, "t1").details === "- Use the Calendly link\n- Pick a weekday")
    const other = await updateTaskDetails(db.client as any, { coachClientId: "cc-other", taskId: "t1", details: "hijack", actor: COACH })
    ok("another client's task is not reachable", !other.ok && (other as any).status === 404)
    const plan = await getPlan(db.client as any, CC)
    ok("the plan returns details", plan[0].tasks.find((t) => t.id === "t1")?.details === "- Use the Calendly link\n- Pick a weekday")
  }

  console.log("\nadding tasks and deliverables")
  {
    const db = seed()
    const r = await addTask(db.client as any, { coachClientId: CC, deliverableId: "d-1", name: "Send practice questions", type: "client", details: "- Five behavioural questions", actor: COACH })
    ok("a one-off task keeps its details", r.ok && r.data.details === "- Five behavioural questions")
    const d = await addDeliverableFromLibrary(db.client as any, { coachClientId: CC, engagementId: "eng-1", milestoneId: "m-lib", coachIds: [COACH], actor: COACH })
    const copied = db.tables.coach_client_engagement_activities.filter((a) => a.source_activity_id === "la1" || a.source_activity_id === "la2")
    ok("adding a library deliverable copies each task's details", d.ok
      && copied.find((a) => a.source_activity_id === "la1")?.details === "- Pick a 60 minute slot\n- Bring your current resume"
      && copied.find((a) => a.source_activity_id === "la2")?.details === null)
  }

  console.log("\nthe To-Do item")
  {
    const db = seed()
    const out = await withPlanDetails(db.client as any, db.tables.coach_tasks as any[])
    ok("a plan task's To-Do item carries its details", out.find((t: any) => t.id === "todo-1")?.plan_details === "Review the job posting")
    ok("an item with no plan task carries none", !("plan_details" in out.find((t: any) => t.id === "todo-2")!))
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
