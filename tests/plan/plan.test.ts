#!/usr/bin/env tsx
// A client's plan, pass A: task states, activation, release, the client
// finishing a task, and customising the plan.
// Run: npx tsx tests/plan/plan.test.ts

import { makeFakeDb, type Row } from "../_lib/fakeSupabase"
import { allowedActions } from "../../lib/plan/service"
import {
  activateOnApproval,
  addDeliverableFromLibrary,
  addTask,
  applyLegacyStatus,
  applyTaskAction,
  clientSetDone,
  getPlan,
  removeDeliverable,
  removeTask,
  reorderTasks,
  setDeliverableNeeded,
  updateTaskDetails,
} from "../../lib/plan/service"
import { taskTitle } from "../../lib/plan/model"
import { getClientPhases } from "../../lib/phases/service"
import { onTodoEdited, onTodoStatus } from "../../lib/plan/service"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const COACH = "coach-1"
const CC = "cc-1"
const CLIENT = "client-1"

/**
 * An approved package: "Resume" (coach draft, client review, coach polish) in
 * Build, then "LinkedIn" (coach audit) in Build too. Everything Upcoming.
 */
function seed(over: { proposal?: string; extra?: Partial<Record<string, Row[]>> } = {}) {
  return makeFakeDb({
    coach_clients: [{ id: CC, coach_profile_id: COACH, status: "active", name: "Jamie Rivera" }],
    coach_phases: ["Know", "Build", "Prove", "Search", "Land"].map((label, i) => ({
      id: `ph-${label.toLowerCase()}`, coach_profile_id: COACH, phase_key: label.toLowerCase(), label, sort_order: i + 1, active: true, is_custom: false,
    })),
    coach_client_engagements: [{ id: "eng-1", coach_client_id: CC, name: "Foundations", proposal_status: over.proposal ?? "approved", attached_at: "2026-09-01" }],
    coach_client_engagement_deliverables: [
      { id: "d-resume", engagement_id: "eng-1", name: "Resume", phase_id: "ph-build", not_needed: false, sort_order: 1 },
      { id: "d-linkedin", engagement_id: "eng-1", name: "LinkedIn", phase_id: "ph-build", not_needed: false, sort_order: 2 },
    ],
    coach_client_engagement_activities: [
      task("t1", "d-resume", "Draft resume", "coach", 1),
      task("t2", "d-resume", "Review the draft", "client", 2),
      task("t3", "d-resume", "Polish resume", "coach", 3),
      task("t4", "d-linkedin", "Audit LinkedIn", "coach", 1),
    ],
    coach_milestones: [
      { id: "m-mock", coach_profile_id: COACH, name: "Mock interview", fee_cents: 10000, category: null, time_estimate_days: 1, phase_id: "ph-prove", active: true },
      { id: "m-other", coach_profile_id: "coach-2", name: "Not mine", fee_cents: null, category: null, time_estimate_days: null, phase_id: null, active: true },
    ],
    coach_milestone_activities: [
      { id: "ma-1", milestone_id: "m-mock", name: "Prep questions", owner: "coach", sort_order: 1 },
      { id: "ma-2", milestone_id: "m-mock", name: "Record answers", owner: "client", sort_order: 2 },
    ],
    client_phase_status: [],
    coach_client_events: [],
    coach_tasks: [],
    ...(over.extra ?? {}),
  })
}
function task(id: string, d: string, name: string, owner: string, sort_order: number, state = "upcoming"): Row {
  return { id, engagement_deliverable_id: d, name, owner, state, sort_order, assignee_profile_id: null, due_date: null, released_at: null, is_signoff: false }
}
type Db = ReturnType<typeof seed>
const t = (db: Db, id: string) => db.tables.coach_client_engagement_activities.find((x) => x.id === id)!
const states = (db: Db, ...ids: string[]) => ids.map((id) => t(db, id).state).join(",")
const plan = (db: Db) => db.tables.coach_client_events.filter((e) => e.event_type === "plan_changed")
const act = (db: Db, taskId: string, action: any) => applyTaskAction(db.client as any, { coachClientId: CC, taskId, action, actor: COACH })
const phase = async (db: Db, label: string) => (await getClientPhases(db.client as any, CC))!.find((p) => p.label === label)!

async function main() {
  console.log("approval activates the first task")
  {
    const db = seed()
    await activateOnApproval(db.client as any, CC, "eng-1")
    ok("the first task of the first deliverable is Active, nothing else", states(db, "t1", "t2", "t3", "t4") === "active,upcoming,upcoming,upcoming")
    ok("every task gets the client's coach as assignee", db.tables.coach_client_engagement_activities.every((x) => x.assignee_profile_id === COACH))
    const h = plan(db)[0]
    ok("History: Upcoming to Active, by SIGNAL, because the package was approved", h?.actor_profile_id === null
      && h?.context.from === "upcoming" && h?.context.to === "active" && h?.context.reason === "the package was approved")
    ok("and the Build phase is In progress", (await phase(db, "Build")).status === "in_progress")
    await activateOnApproval(db.client as any, CC, "eng-1")
    ok("approving again does not activate a second task", states(db, "t1", "t2", "t3", "t4") === "active,upcoming,upcoming,upcoming")
  }
  {
    const db = seed()
    db.tables.coach_client_engagement_deliverables[0].not_needed = true
    await activateOnApproval(db.client as any, CC, "eng-1")
    ok("a Not needed first deliverable is passed over", states(db, "t1", "t4") === "upcoming,active")
  }

  console.log("\nfinishing a task activates the next")
  {
    const db = seed()
    await activateOnApproval(db.client as any, CC, "eng-1")
    await act(db, "t1", "done")
    ok("Done on the coach task, the next (a client task) becomes Active", states(db, "t1", "t2") === "done,active")
    ok("an Active client task is the coach's to release: \"Release: [task]\"",
      taskTitle(t(db, "t2") as any) === "Release: Review the draft")
    ok("it is not released by itself", t(db, "t2").released_at === null)
    ok("the other deliverable is untouched", t(db, "t4").state === "upcoming")

    await act(db, "t2", "release")
    ok("the coach releases it: Waiting on client, with the release time", t(db, "t2").state === "waiting_on_client" && !!t(db, "t2").released_at)

    const c = await clientSetDone(db.client as any, { coachClientId: CC, taskId: "t2", done: true, actor: CLIENT })
    ok("the client marks it done in their hub", c.ok && t(db, "t2").state === "done")
    ok("which activates the next task", t(db, "t3").state === "active")
    ok("History says the client did it", plan(db).some((e) => e.context.task === "Review the draft" && e.context.to === "done" && e.context.by_client === true))
    ok("and the streak's 'activity completed' line is kept", db.tables.coach_client_events.some((e) => e.event_type === "activity_completed" && e.context.name === "Review the draft"))
  }
  {
    const db = seed({ extra: { coach_client_engagement_activities: [
      task("t1", "d-resume", "Draft", "coach", 1, "active"),
      task("t2", "d-resume", "Skip me", "coach", 2, "not_needed"),
      task("t3", "d-resume", "Polish", "coach", 3),
    ] } })
    await act(db, "t1", "skip")
    ok("Skipped also hands on, and Not needed tasks are passed over", states(db, "t1", "t2", "t3") === "skipped,not_needed,active")
  }
  {
    const db = seed()
    await activateOnApproval(db.client as any, CC, "eng-1")
    await act(db, "t1", "not_needed")
    ok("marking the Active task Not needed hands on to the next", states(db, "t1", "t2") === "not_needed,active")
  }

  console.log("\nthe coach acts by hand")
  {
    const db = seed()
    ok("any Upcoming task can be activated, in any order", (await act(db, "t3", "activate")).ok && t(db, "t3").state === "active")
    ok("an Upcoming client task can be released directly", (await act(db, "t2", "release")).ok && t(db, "t2").state === "waiting_on_client")
    ok("a coach task cannot be released", !(await act(db, "t4", "release")).ok)
    await act(db, "t3", "done")
    ok("Undo returns a coach task to Active", (await act(db, "t3", "undo")).ok && t(db, "t3").state === "active")
    await act(db, "t2", "done")
    ok("and a released client task to Waiting on client", (await act(db, "t2", "undo")).ok && t(db, "t2").state === "waiting_on_client")
    ok("allowed actions follow the state", allowedActions({ owner: "coach", state: "done" }).join() === "undo"
      && allowedActions({ owner: "client", state: "upcoming" }).includes("release"))
    ok("another client's task is not found", !(await applyTaskAction(db.client as any, { coachClientId: "cc-other", taskId: "t1", action: "done", actor: COACH })).ok)
  }

  console.log("\nthe client's limits")
  {
    const db = seed()
    ok("a client cannot finish a task that isn't released", !(await clientSetDone(db.client as any, { coachClientId: CC, taskId: "t2", done: true, actor: CLIENT })).ok)
    ok("nor a coach task", !(await clientSetDone(db.client as any, { coachClientId: CC, taskId: "t1", done: true, actor: CLIENT })).ok)
    await act(db, "t2", "release")
    await clientSetDone(db.client as any, { coachClientId: CC, taskId: "t2", done: true, actor: CLIENT })
    const undo = await clientSetDone(db.client as any, { coachClientId: CC, taskId: "t2", done: false, actor: CLIENT })
    ok("and can undo their own done", undo.ok && t(db, "t2").state === "waiting_on_client")
  }

  console.log("\nthe old Engagements status control")
  {
    const db = seed()
    await applyLegacyStatus(db.client as any, { coachClientId: CC, taskId: "t1", status: "complete", actor: COACH })
    ok("complete means Done, and the next task activates", states(db, "t1", "t2") === "done,active")
    await applyLegacyStatus(db.client as any, { coachClientId: CC, taskId: "t2", status: "in_progress", actor: COACH })
    ok("in progress on a client task releases it", t(db, "t2").state === "waiting_on_client")
    await applyLegacyStatus(db.client as any, { coachClientId: CC, taskId: "t4", status: "in_progress", actor: COACH })
    ok("in progress on a coach task means Active", t(db, "t4").state === "active")
  }

  console.log("\ncustomising the plan")
  {
    const db = seed()
    await setDeliverableNeeded(db.client as any, { coachClientId: CC, deliverableId: "d-resume", notNeeded: true, actor: COACH })
    ok("a deliverable marked Not needed stays on the plan", (await getPlan(db.client as any, CC)).some((d) => d.id === "d-resume" && d.not_needed))
    ok("its tasks can't be acted on", !(await act(db, "t1", "activate")).ok)
    ok("History records it", plan(db).at(-1)?.context.action === "deliverable_not_needed")
    ok("Build stays in plan while LinkedIn is still needed", (await phase(db, "Build")).status === "not_started")
    await setDeliverableNeeded(db.client as any, { coachClientId: CC, deliverableId: "d-linkedin", notNeeded: true, actor: COACH })
    ok("every deliverable in Build Not needed: Build is Not in plan", (await phase(db, "Build")).status === "not_in_plan")
    await setDeliverableNeeded(db.client as any, { coachClientId: CC, deliverableId: "d-linkedin", notNeeded: false, actor: COACH })
    ok("restoring one brings Build back", (await phase(db, "Build")).status === "not_started")
  }
  {
    const db = seed()
    await act(db, "t3", "not_needed")
    const p = await phase(db, "Build")
    ok("a Not needed task is not counted", p.tasks_total === 3, String(p.tasks_total))
    await act(db, "t1", "skip")
    ok("a Skipped task counts as finished", (await phase(db, "Build")).tasks_done === 1)
  }
  {
    const db = seed()
    await activateOnApproval(db.client as any, CC, "eng-1")
    await removeTask(db.client as any, { coachClientId: CC, taskId: "t1", actor: COACH })
    ok("removing the Active task hands on to the next", !db.tables.coach_client_engagement_activities.some((x) => x.id === "t1") && t(db, "t2").state === "active")
    ok("History records the removal", plan(db).some((e) => e.context.action === "task_removed" && e.context.task === "Draft resume"))
    await removeDeliverable(db.client as any, { coachClientId: CC, deliverableId: "d-linkedin", actor: COACH })
    ok("removing a deliverable takes its tasks with it", !db.tables.coach_client_engagement_deliverables.some((d) => d.id === "d-linkedin")
      && !db.tables.coach_client_engagement_activities.some((x) => x.id === "t4"))
  }
  {
    const db = seed()
    const r = await addTask(db.client as any, { coachClientId: CC, deliverableId: "d-resume", name: "Extra round", type: "client", actor: COACH })
    ok("a one-off task goes at the end, Upcoming, assigned to the coach", r.ok && r.data.sort_order === 4 && r.data.state === "upcoming"
      && t(db, r.ok ? r.data.id : "").assignee_profile_id === COACH && t(db, r.ok ? r.data.id : "").owner === "client")
    ok("an empty name is refused", !(await addTask(db.client as any, { coachClientId: CC, deliverableId: "d-resume", name: " ", type: "coach", actor: COACH })).ok)

    ok("reorder needs every task, once", !(await reorderTasks(db.client as any, { coachClientId: CC, deliverableId: "d-resume", taskIds: ["t1", "t2"], actor: COACH })).ok)
    const ids = ["t3", "t1", "t2", r.ok ? r.data.id : ""]
    await reorderTasks(db.client as any, { coachClientId: CC, deliverableId: "d-resume", taskIds: ids, actor: COACH })
    ok("tasks are reordered", (await getPlan(db.client as any, CC))[0].tasks.map((x) => x.id).join() === ids.join())
  }
  {
    const db = seed()
    const r = await addDeliverableFromLibrary(db.client as any, { coachClientId: CC, engagementId: "eng-1", milestoneId: "m-mock", coachIds: [COACH], actor: COACH })
    const d = db.tables.coach_client_engagement_deliverables.find((x) => x.name === "Mock interview")
    ok("a library deliverable is copied into the package, with its phase", r.ok && d?.phase_id === "ph-prove" && d?.sort_order === 3)
    const copies = db.tables.coach_client_engagement_activities.filter((x) => x.engagement_deliverable_id === d?.id)
    ok("its tasks come too, Upcoming, keeping their type", copies.map((x) => `${x.name}:${x.owner}:${x.state}`).join() === "Prep questions:coach:upcoming,Record answers:client:upcoming")
    ok("Prove is now in the plan", (await phase(db, "Prove")).status === "not_started")
    ok("the library is untouched", db.tables.coach_milestone_activities.length === 2 && db.tables.coach_milestones.length === 2)
    ok("another coach's deliverable is refused", !(await addDeliverableFromLibrary(db.client as any, { coachClientId: CC, engagementId: "eng-1", milestoneId: "m-other", coachIds: [COACH], actor: COACH })).ok)
  }
  {
    const db = seed({ proposal: "draft" })
    ok("deliverables are added to approved packages only",
      !(await addDeliverableFromLibrary(db.client as any, { coachClientId: CC, engagementId: "eng-1", milestoneId: "m-mock", coachIds: [COACH], actor: COACH })).ok)
    ok("and a draft package is not the plan", (await getPlan(db.client as any, CC)).length === 0)
  }
  {
    const db = seed()
    await updateTaskDetails(db.client as any, { coachClientId: CC, taskId: "t1", assignee: "coach-2", actor: COACH })
    await updateTaskDetails(db.client as any, { coachClientId: CC, taskId: "t1", dueDate: "2026-10-20", actor: COACH })
    ok("assignee and due date change, each logged", t(db, "t1").assignee_profile_id === "coach-2" && t(db, "t1").due_date === "2026-10-20"
      && plan(db).filter((e) => e.context.action === "task_assigned" || e.context.action === "task_due").length === 2)
    ok("a bad date is refused", !(await updateTaskDetails(db.client as any, { coachClientId: CC, taskId: "t1", dueDate: "soon", actor: COACH })).ok)
  }

  console.log("\nthe To-Do list")
  {
    const db = seed()
    const todos = () => db.tables.coach_tasks
    const open = () => todos().filter((x) => x.status === "open")
    await activateOnApproval(db.client as any, CC, "eng-1")
    ok("an Active task gets one open To-Do item for its assignee", open().length === 1
      && open()[0].title === "Draft resume" && open()[0].assignee_profile_id === COACH && open()[0].plan_activity_id === "t1")
    ok("linked to the client record, as an automatic task", open()[0].link === "/dashboard/coach/coach-clients/cc-1" && open()[0].source === "auto"
      && open()[0].coach_client_id === CC)

    await act(db, "t1", "done")
    ok("Done on the plan closes it as done", todos().find((x) => x.plan_activity_id === "t1")?.status === "done")
    ok("and the next task's item appears: \"Release: [task]\"", open().length === 1 && open()[0].title === "Release: Review the draft")

    await act(db, "t2", "release")
    ok("releasing closes the Release item (the client has it now)", open().length === 0
      && todos().find((x) => x.plan_activity_id === "t2")?.status === "cancelled")

    await act(db, "t4", "activate")
    await updateTaskDetails(db.client as any, { coachClientId: CC, taskId: "t4", dueDate: "2026-10-20", actor: COACH })
    ok("a due date on the plan reaches the To-Do item", open()[0].due_at === "2026-10-20T12:00:00.000Z")
    await setDeliverableNeeded(db.client as any, { coachClientId: CC, deliverableId: "d-linkedin", notNeeded: true, actor: COACH })
    ok("a Not needed deliverable takes its items off the list", open().length === 0)
    await setDeliverableNeeded(db.client as any, { coachClientId: CC, deliverableId: "d-linkedin", notNeeded: false, actor: COACH })
    ok("and restoring it puts them back", open().length === 1 && open()[0].plan_activity_id === "t4")
    await removeTask(db.client as any, { coachClientId: CC, taskId: "t4", actor: COACH })
    ok("removing the task cancels its item", open().length === 0)
  }
  {
    const db = seed()
    const todos = () => db.tables.coach_tasks
    await activateOnApproval(db.client as any, CC, "eng-1")
    const item = todos()[0]
    item.status = "done" // the coach ticks it on the To-Do list
    await onTodoStatus(db.client as any, item as any, "done", COACH)
    ok("ticking the To-Do item finishes the plan task", t(db, "t1").state === "done" && t(db, "t2").state === "active")
    const rel = todos().find((x) => x.plan_activity_id === "t2" && x.status === "open")!
    rel.status = "done"
    await onTodoStatus(db.client as any, rel as any, "done", COACH)
    ok("ticking a \"Release:\" item releases the client task", t(db, "t2").state === "waiting_on_client")

    item.status = "open" // reopened on the To-Do list
    await onTodoStatus(db.client as any, item as any, "open", COACH)
    ok("reopening it puts the plan task back to Active", t(db, "t1").state === "active")
    ok("without a second open item", todos().filter((x) => x.plan_activity_id === "t1" && x.status === "open").length === 1)

    await onTodoEdited(db.client as any, { plan_activity_id: "t1", coach_client_id: CC, due_at: "2026-11-02T12:00:00.000Z" }, COACH)
    await onTodoEdited(db.client as any, { plan_activity_id: "t1", coach_client_id: CC, assignee_profile_id: "coach-2" }, COACH)
    ok("a due date or new assignee set on the To-Do goes back to the plan", t(db, "t1").due_date === "2026-11-02" && t(db, "t1").assignee_profile_id === "coach-2")

    const before = t(db, "t1").state
    await onTodoStatus(db.client as any, item as any, "cancelled", COACH)
    ok("dismissing the item leaves the plan alone", t(db, "t1").state === before)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
