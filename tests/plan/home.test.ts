#!/usr/bin/env tsx
// Coach Home's plan blocks: follow-ups due, and clients by phase.
// Run: npx tsx tests/plan/home.test.ts

import { makeFakeDb } from "../_lib/fakeSupabase"
import { getHomeBlocks } from "../../lib/plan/home"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const COACH = "coach-1"
const NOW = new Date("2026-10-10T12:00:00Z")
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString()

function seed() {
  return makeFakeDb({
    coach_clients: [
      { id: "cc-a", coach_profile_id: COACH, status: "active", lifecycle_status: "Active", name: "Ava Lee", client_profile_id: "p-a" },
      { id: "cc-b", coach_profile_id: COACH, status: "active", lifecycle_status: "Active", name: null, client_profile_id: "p-b" },
      { id: "cc-c", coach_profile_id: COACH, status: "active", lifecycle_status: "Active", name: "Cam Diaz", client_profile_id: null },
      { id: "cc-p", coach_profile_id: COACH, status: "active", lifecycle_status: "Prospect", name: "Pat Prospect", client_profile_id: null },
      { id: "cc-x", coach_profile_id: "coach-2", status: "active", lifecycle_status: "Active", name: "Not mine", client_profile_id: null },
    ],
    client_profiles: [{ id: "p-b", name: "Ben Ortiz", email: "ben@example.com" }],
    coach_phases: ["Know", "Build", "Prove"].map((label, i) => ({ id: `ph-${label.toLowerCase()}`, coach_profile_id: COACH, label, sort_order: i + 1, active: true })),
    coach_client_engagements: [
      { id: "e-a", coach_client_id: "cc-a", proposal_status: "approved" },
      { id: "e-b", coach_client_id: "cc-b", proposal_status: "approved" },
      { id: "e-c", coach_client_id: "cc-c", proposal_status: "draft" },
    ],
    coach_client_engagement_deliverables: [
      { id: "d-a1", engagement_id: "e-a", phase_id: "ph-know", not_needed: false },
      { id: "d-a2", engagement_id: "e-a", phase_id: "ph-build", not_needed: false },
      { id: "d-b1", engagement_id: "e-b", phase_id: "ph-build", not_needed: false },
      { id: "d-b2", engagement_id: "e-b", phase_id: "ph-prove", not_needed: true },
      { id: "d-c1", engagement_id: "e-c", phase_id: "ph-know", not_needed: false },
    ],
    coach_client_engagement_activities: [
      { id: "t1", name: "Fill in the intake", engagement_deliverable_id: "d-a1", state: "waiting_on_client", released_at: daysAgo(5) },
      { id: "t2", name: "Send old resumes", engagement_deliverable_id: "d-a2", state: "waiting_on_client", released_at: daysAgo(2) },
      { id: "t3", name: "Review draft", engagement_deliverable_id: "d-b1", state: "waiting_on_client", released_at: daysAgo(3) },
      { id: "t4", name: "Practice answers", engagement_deliverable_id: "d-b2", state: "waiting_on_client", released_at: daysAgo(9) },
      { id: "t5", name: "Draft thing", engagement_deliverable_id: "d-c1", state: "waiting_on_client", released_at: daysAgo(9) },
    ],
    client_phase_status: [
      { coach_client_id: "cc-a", phase_id: "ph-know", status: "in_progress" },
      { coach_client_id: "cc-a", phase_id: "ph-build", status: "in_progress" },
      { coach_client_id: "cc-b", phase_id: "ph-build", status: "complete" },
      { coach_client_id: "cc-b", phase_id: "ph-prove", status: "in_progress" },
    ],
  })
}

async function main() {
  const db = seed()
  const { followUps, clientsByPhase } = await getHomeBlocks(db.client as any, [COACH], NOW)

  console.log("follow-ups due")
  ok("client tasks waiting 3 or more days, oldest first", followUps.map((f) => f.task).join() === "Fill in the intake,Review draft",
    followUps.map((f) => f.task).join())
  ok("with the client's name, days waiting and a link to their record",
    followUps[0].client === "Ava Lee" && followUps[0].days_waiting === 5 && followUps[0].href === "/dashboard/coach/clients/p-a")
  ok("a client with no name on the record uses their profile's", followUps[1].client === "Ben Ortiz")
  ok("tasks in a Not needed deliverable or an unapproved package are left out",
    !followUps.some((f) => f.task === "Practice answers" || f.task === "Draft thing"))

  console.log("\nclients by phase")
  const b = (label: string) => clientsByPhase.find((x) => x.label === label)!.clients.map((c) => c.name).join()
  ok("each phase lists the clients with it In progress", b("Know") === "Ava Lee" && b("Build") === "Ava Lee")
  ok("a client with two phases In progress is under both", b("Know").includes("Ava") && b("Build").includes("Ava"))
  ok("an In progress phase that is no longer in the plan does not count", b("Prove") === "")
  ok("clients with nothing In progress are under Not started", b("Not started") === "Ben Ortiz,Cam Diaz", b("Not started"))
  ok("phases in the coach's order, Not started last", clientsByPhase.map((x) => x.label).join() === "Know,Build,Prove,Not started")
  ok("prospects and other coaches' clients are not counted",
    !clientsByPhase.some((x) => x.clients.some((c) => c.name === "Pat Prospect" || c.name === "Not mine")))
  ok("a client without an account links to their converted-client page",
    clientsByPhase.find((x) => x.label === "Not started")!.clients.find((c) => c.name === "Cam Diaz")?.href === "/dashboard/coach/coach-clients/cc-c")

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
