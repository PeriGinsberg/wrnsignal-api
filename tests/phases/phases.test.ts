#!/usr/bin/env tsx
// Client phases: the coach's phase list, and each client's phase status.
// Run: npx tsx tests/phases/phases.test.ts

import { makeFakeDb, type Row } from "../_lib/fakeSupabase"
import { isMoveBack } from "../../lib/phases/model"
import {
  autoStartPhases,
  ensurePhases,
  fillDeliverablePhase,
  getClientPhases,
  isOwnPhase,
  savePhases,
  setPhaseStatus,
} from "../../lib/phases/service"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const COACH = "coach-1"
const OTHER = "coach-2"
const CC = "cc-1"

function phaseRows(coach = COACH): Row[] {
  return ["Know", "Build", "Prove", "Search", "Land"].map((label, i) => ({
    id: `ph-${label.toLowerCase()}`, coach_profile_id: coach, phase_key: label.toLowerCase(), label,
    sort_order: i + 1, active: true, is_custom: false,
  }))
}

/**
 * Jamie's plan: an APPROVED package with a Know deliverable (2 tasks) and a
 * Build deliverable (1 task), plus a DRAFT package with a Prove deliverable.
 */
function seed(extra: Partial<Record<string, Row[]>> = {}) {
  return makeFakeDb({
    coach_clients: [{ id: CC, coach_profile_id: COACH, status: "active", name: "Jamie Rivera" }],
    coach_phases: phaseRows(),
    coach_client_engagements: [
      { id: "eng-ok", coach_client_id: CC, proposal_status: "approved" },
      { id: "eng-draft", coach_client_id: CC, proposal_status: "draft" },
    ],
    coach_client_engagement_deliverables: [
      { id: "d-know", engagement_id: "eng-ok", phase_id: "ph-know", source_milestone_id: "m-know" },
      { id: "d-build", engagement_id: "eng-ok", phase_id: "ph-build", source_milestone_id: "m-build" },
      { id: "d-prove", engagement_id: "eng-draft", phase_id: "ph-prove", source_milestone_id: "m-prove" },
    ],
    coach_client_engagement_activities: [
      { id: "a1", engagement_deliverable_id: "d-know", status: "not_started" },
      { id: "a2", engagement_deliverable_id: "d-know", status: "not_started" },
      { id: "a3", engagement_deliverable_id: "d-build", status: "not_started" },
      { id: "a4", engagement_deliverable_id: "d-prove", status: "complete" },
    ],
    client_phase_status: [],
    coach_client_events: [],
    ...extra,
  })
}
type Db = ReturnType<typeof seed>
const phases = async (db: Db) => (await getClientPhases(db.client as any, CC))!
const statusOf = async (db: Db, label: string) => (await phases(db)).find((p) => p.label === label)!
const history = (db: Db) => db.tables.coach_client_events.filter((e) => e.event_type === "phase_status_changed")
const setTask = (db: Db, id: string, status: string) => {
  db.tables.coach_client_engagement_activities.find((a) => a.id === id)!.status = status
}

async function main() {
  console.log("the coach's phases")
  {
    const db = makeFakeDb({ coach_phases: [] })
    const first = await ensurePhases(db.client as any, COACH)
    ok("a coach with none gets Know, Build, Prove, Search, Land, in order",
      first.map((p) => p.label).join(",") === "Know,Build,Prove,Search,Land")
    await ensurePhases(db.client as any, COACH)
    ok("reading again does not seed twice", db.tables.coach_phases.length === 5)
    ok("seeded for that coach only", db.tables.coach_phases.every((p) => p.coach_profile_id === COACH))
  }
  {
    const db = makeFakeDb({ coach_phases: phaseRows() })
    const [know, build, prove, search, land] = await ensurePhases(db.client as any, COACH)
    const r = await savePhases(db.client as any, COACH, [
      { id: build.id, label: "Build", active: true },
      { id: know.id, label: "Discover", active: true },
      { id: prove.id, label: "Prove", active: false },
      { id: search.id, label: "Search", active: true },
      { id: land.id, label: "Land", active: true },
      { label: "Grow", active: true },
    ])
    ok("saves the order, a rename and an inactive phase", r.ok
      && r.data.map((p) => `${p.label}${p.active ? "" : "(off)"}`).join(",") === "Build,Discover,Prove(off),Search,Land,Grow",
      r.ok ? r.data.map((p) => p.label).join(",") : r.error)
    ok("a rename keeps the phase's key", r.ok && r.data.find((p) => p.label === "Discover")?.phase_key === "know")
    ok("a new phase is marked custom", r.ok && r.data.find((p) => p.label === "Grow")?.is_custom === true)
    ok("nothing is deleted", db.tables.coach_phases.length === 6)
  }
  {
    const db = makeFakeDb({ coach_phases: [...phaseRows(), ...phaseRows(OTHER).map((p) => ({ ...p, id: `x-${p.id}` }))] })
    const own = await ensurePhases(db.client as any, COACH)
    ok("an empty name is refused", !(await savePhases(db.client as any, COACH, [{ id: own[0].id, label: " ", active: true }])).ok)
    ok("another coach's phase is refused", !(await savePhases(db.client as any, COACH, [{ id: "x-ph-know", label: "Mine", active: true }])).ok)
    ok("switching every phase off is refused", !(await savePhases(db.client as any, COACH, own.map((p) => ({ id: p.id, label: p.label, active: false })))).ok)
    ok("a deliverable may take one of the coach's phases, or none",
      (await isOwnPhase(db.client as any, [COACH], "ph-know")) && (await isOwnPhase(db.client as any, [COACH], null)))
    ok("but not another coach's", !(await isOwnPhase(db.client as any, [COACH], "x-ph-know")))
  }

  console.log("\nwhat the stepper shows")
  {
    const db = seed()
    const p = await phases(db)
    ok("every active phase, in order", p.map((x) => x.label).join(",") === "Know,Build,Prove,Search,Land")
    ok("phases with a deliverable in an APPROVED package start Not started",
      p[0].status === "not_started" && p[1].status === "not_started")
    ok("a phase only in a DRAFT package is Not in plan", p[2].status === "not_in_plan", p[2].status)
    ok("a phase with no deliverable at all is Not in plan", p[3].status === "not_in_plan" && p[4].status === "not_in_plan")
    ok("tasks done / total per phase", p[0].tasks_done === 0 && p[0].tasks_total === 2 && p[1].tasks_total === 1)
    ok("a draft package's tasks are not counted", p[2].tasks_total === 0)
  }
  {
    const db = seed()
    db.tables.coach_client_engagements.find((e) => e.id === "eng-draft")!.proposal_status = "approved"
    ok("approving the draft puts Prove in the plan", (await statusOf(db, "Prove")).status === "not_started")
    db.tables.coach_client_engagements.find((e) => e.id === "eng-draft")!.proposal_status = "declined"
    ok("a declined package does not count", (await statusOf(db, "Prove")).status === "not_in_plan")
    db.tables.coach_client_engagements.find((e) => e.id === "eng-draft")!.proposal_status = "sent"
    ok("nor does a sent one", (await statusOf(db, "Prove")).status === "not_in_plan")
  }
  {
    const db = seed({
      coach_phases: phaseRows().map((p) => (p.label === "Land" ? { ...p, active: false } : p)),
    })
    ok("an inactive phase is not shown", !(await phases(db)).some((p) => p.label === "Land"))
  }

  console.log("\nsetting a status")
  {
    const db = seed()
    const r = await setPhaseStatus(db.client as any, { coachClientId: CC, phaseId: "ph-know", status: "in_progress", actor: COACH })
    ok("the coach sets In progress", r.ok && r.data.changed && (await statusOf(db, "Know")).status === "in_progress")
    const h = history(db)[0]
    ok("History records who, the phase, from and to", h?.actor_profile_id === COACH && h?.context.phase_label === "Know"
      && h?.context.from === "not_started" && h?.context.to === "in_progress" && h?.context.auto === false)

    const c = await setPhaseStatus(db.client as any, { coachClientId: CC, phaseId: "ph-know", status: "complete", actor: COACH })
    ok("Complete is allowed with tasks still open", c.ok && (await statusOf(db, "Know")).status === "complete"
      && (await statusOf(db, "Know")).tasks_done === 0)
    ok("and one row per client per phase", db.tables.client_phase_status.filter((x) => x.phase_id === "ph-know").length === 1)

    const again = await setPhaseStatus(db.client as any, { coachClientId: CC, phaseId: "ph-know", status: "complete", actor: COACH })
    ok("setting the same status changes nothing and logs nothing", again.ok && !again.data.changed && history(db).length === 2)

    const back = await setPhaseStatus(db.client as any, { coachClientId: CC, phaseId: "ph-know", status: "not_started", actor: COACH })
    ok("a phase can be moved back", back.ok && (await statusOf(db, "Know")).status === "not_started"
      && history(db).at(-1)?.context.from === "complete")

    await setPhaseStatus(db.client as any, { coachClientId: CC, phaseId: "ph-know", status: "in_progress", actor: COACH })
    await setPhaseStatus(db.client as any, { coachClientId: CC, phaseId: "ph-build", status: "in_progress", actor: COACH })
    ok("more than one phase can be In progress", (await phases(db)).filter((p) => p.status === "in_progress").length === 2)

    const notInPlan = await setPhaseStatus(db.client as any, { coachClientId: CC, phaseId: "ph-search", status: "in_progress", actor: COACH })
    ok("a phase not in the plan cannot be set", !notInPlan.ok && notInPlan.status === 409)
    ok("an unknown phase is refused", !(await setPhaseStatus(db.client as any, { coachClientId: CC, phaseId: "nope", status: "complete", actor: COACH })).ok)
  }
  {
    ok("move back is any step down the order", isMoveBack("complete", "in_progress") && isMoveBack("in_progress", "not_started")
      && !isMoveBack("not_started", "in_progress") && !isMoveBack("not_started", "complete"))
  }

  console.log("\nIn progress by itself, and ready to complete")
  {
    const db = seed()
    await autoStartPhases(db.client as any, CC, "test")
    ok("no task started, nothing moves", (await statusOf(db, "Know")).status === "not_started" && history(db).length === 0)

    setTask(db, "a1", "in_progress")
    await autoStartPhases(db.client as any, CC, 'task "a1" started')
    ok("a task moving to in progress moves its phase to In progress", (await statusOf(db, "Know")).status === "in_progress")
    ok("only that phase", (await statusOf(db, "Build")).status === "not_started")
    const h = history(db)[0]
    ok("History says SIGNAL did it, and why", h?.actor_profile_id === null && h?.context.auto === true
      && h?.context.reason === 'task "a1" started')

    setTask(db, "a1", "not_started")
    await autoStartPhases(db.client as any, CC, "test")
    ok("a task going back does not move the phase back", (await statusOf(db, "Know")).status === "in_progress")
  }
  {
    const db = seed()
    setTask(db, "a3", "complete")
    await autoStartPhases(db.client as any, CC, "test")
    ok("a task moving straight to complete also starts the phase", (await statusOf(db, "Build")).status === "in_progress")
    const b = await statusOf(db, "Build")
    ok("every task done shows ready to mark complete", b.ready_to_complete && b.tasks_done === 1 && b.tasks_total === 1)
    ok("but never completes it by itself", b.status === "in_progress")
    await setPhaseStatus(db.client as any, { coachClientId: CC, phaseId: "ph-build", status: "complete", actor: COACH })
    ok("once Complete, no longer 'ready'", !(await statusOf(db, "Build")).ready_to_complete)
  }
  {
    const db = seed()
    await setPhaseStatus(db.client as any, { coachClientId: CC, phaseId: "ph-know", status: "in_progress", actor: COACH })
    await setPhaseStatus(db.client as any, { coachClientId: CC, phaseId: "ph-know", status: "not_started", actor: COACH })
    setTask(db, "a1", "in_progress")
    await autoStartPhases(db.client as any, CC, "test")
    ok("SIGNAL leaves a phase alone once the coach has set it", (await statusOf(db, "Know")).status === "not_started")
  }
  {
    const db = seed()
    ok("a task in a draft package starts nothing", (await autoStartPhases(db.client as any, CC, "test")).length === 0
      && (await statusOf(db, "Prove")).status === "not_in_plan")
  }

  console.log("\ndeliverables get their phase")
  {
    const db = seed({
      coach_client_engagement_deliverables: [
        { id: "d-old", engagement_id: "eng-ok", phase_id: null, source_milestone_id: "m-search" },
        { id: "d-set", engagement_id: "eng-ok", phase_id: "ph-land", source_milestone_id: "m-search" },
      ],
    })
    ok("Search is Not in plan while its deliverable has no phase", (await statusOf(db, "Search")).status === "not_in_plan")
    await fillDeliverablePhase(db.client as any, "m-search", "ph-search")
    ok("giving the library deliverable a phase fills clients' copies that had none",
      db.tables.coach_client_engagement_deliverables.find((d) => d.id === "d-old")?.phase_id === "ph-search")
    ok("a copy that already had a phase keeps it",
      db.tables.coach_client_engagement_deliverables.find((d) => d.id === "d-set")?.phase_id === "ph-land")
    ok("so Search is now in the plan", (await statusOf(db, "Search")).status === "not_started")
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
