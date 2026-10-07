#!/usr/bin/env tsx
// Share with Client finishes the plan's "Share plan with client" task, and the
// next task becomes Active. Run: npx tsx tests/plan/complete-named.test.ts

import { makeFakeDb } from "../_lib/fakeSupabase"
import { completeTaskNamed } from "../../lib/plan/service"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const COACH = "coach-1"
const CC = "cc-1"

function seed(over: { shareState?: string; notNeeded?: boolean; proposal?: string } = {}) {
  const task = (id: string, name: string, owner: string, state: string, sort_order: number) =>
    ({ id, engagement_deliverable_id: "d-net", name, owner, state, sort_order, assignee_profile_id: COACH, due_date: null, released_at: null, is_signoff: false, welcome_release: false })
  return makeFakeDb({
    coach_clients: [{ id: CC, coach_profile_id: COACH, name: "Aiden Park", client_profile_id: null, status: "active" }],
    client_profiles: [{ id: COACH, is_coach: true, name: "Peri", email: "peri@example.com" }],
    coach_client_engagements: [{ id: "eng-1", coach_client_id: CC, name: "Run the Search", proposal_status: over.proposal ?? "approved", attached_at: "2026-10-01" }],
    coach_client_engagement_deliverables: [
      { id: "d-net", engagement_id: "eng-1", name: "Networking Campaign", phase_id: null, not_needed: !!over.notNeeded, sort_order: 1 },
    ],
    coach_client_engagement_activities: [
      task("t4", "Upload campaign and build plan", "coach", "done", 4),
      task("t5", "Share plan with client", "coach", over.shareState ?? "active", 5),
      task("t6", "Book Review Networking Plan session", "client", "upcoming", 6),
    ],
    coach_phases: [],
    client_phase_status: [],
    coach_tasks: [],
    coach_client_events: [],
  })
}
const t = (db: ReturnType<typeof seed>, id: string) => db.tables.coach_client_engagement_activities.find((x) => x.id === id)!

async function main() {
  {
    const db = seed()
    const r = await completeTaskNamed(db.client as any, { coachClientId: CC, name: "Share plan with client", actor: COACH })
    ok("finishes the task", r === "Share plan with client" && t(db, "t5").state === "done")
    ok("the next task becomes Active", t(db, "t6").state === "active")
    ok("History records it, by the coach", db.tables.coach_client_events.some((e) => e.event_type === "plan_changed" && e.context.task === "Share plan with client" && e.context.to === "done" && e.actor_profile_id === COACH))
    ok("a second share changes nothing", (await completeTaskNamed(db.client as any, { coachClientId: CC, name: "Share plan with client", actor: COACH })) === null)
  }
  {
    const db = seed({ shareState: "upcoming" })
    await completeTaskNamed(db.client as any, { coachClientId: CC, name: "SHARE PLAN WITH CLIENT", actor: COACH })
    ok("Upcoming counts too, and case doesn't matter", t(db, "t5").state === "done" && t(db, "t6").state === "active")
  }
  {
    const db = seed({ notNeeded: true })
    ok("a Not needed deliverable is left alone", (await completeTaskNamed(db.client as any, { coachClientId: CC, name: "Share plan with client", actor: COACH })) === null && t(db, "t5").state === "active")
  }
  {
    const db = seed({ proposal: "sent" })
    ok("a package not yet approved is not the plan", (await completeTaskNamed(db.client as any, { coachClientId: CC, name: "Share plan with client", actor: COACH })) === null && t(db, "t5").state === "active")
  }
  {
    const db = seed({ shareState: "skipped" })
    ok("a task already finished is left alone", (await completeTaskNamed(db.client as any, { coachClientId: CC, name: "Share plan with client", actor: COACH })) === null && t(db, "t5").state === "skipped")
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
