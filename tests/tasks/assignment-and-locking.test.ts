#!/usr/bin/env tsx
// Task writes, practice-task closing, event claiming, the status race, the
// active-relationship check and who a task may be assigned to.
// Run: npx tsx tests/tasks/assignment-and-locking.test.ts
//
// Logic only, against tests/_lib/fakeSupabase.ts. What Postgres itself
// guarantees (the row lock behind a claim, the CHECKs) is covered by running
// the smokes in tests/tasks and tests/automation against dev.

import { makeFakeDb, type Row } from "../_lib/fakeSupabase"
import { createTask, reassignTask, setTaskStatus, updateTask } from "../../lib/tasks/service"
import { coachesWhoCanReach, UNREACHABLE_ASSIGNEE } from "../../lib/tasks/scope"
import { cleanTaskLink, practiceRoundLink } from "../../lib/tasks/links"
import { closePracticeRoundTask, raiseCoachTask } from "../../lib/practice/server"
import { claimEvent, runEvent, runPending, CLAIM_TTL_MS } from "../../lib/automation/run"
import { isCoachClientOwnedByCoach } from "../../app/api/_lib/coachEngagements"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

// The cast of characters. No emails, so no task email is attempted.
const LEAD = "coach-lead"        // coaches the client
const DELEGATE = "coach-delegate" // delegates for LEAD
const STRANGER = "coach-stranger" // coaches someone else
const REVOKED = "coach-revoked"   // used to coach the client
const CLIENT = "client-1"
const OTHER_CLIENT = "client-2"

function seed(extra: Record<string, Row[]> = {}) {
  return makeFakeDb({
    client_profiles: [
      { id: LEAD, name: "Lead", is_coach: true },
      { id: DELEGATE, name: "Delegate", is_coach: true },
      { id: STRANGER, name: "Stranger", is_coach: true },
      { id: REVOKED, name: "Revoked", is_coach: true },
      { id: CLIENT, name: "Client One", is_coach: false },
      { id: OTHER_CLIENT, name: "Client Two", is_coach: false },
    ],
    coach_clients: [
      { id: "cc-lead", coach_profile_id: LEAD, client_profile_id: CLIENT, status: "active" },
      { id: "cc-revoked", coach_profile_id: REVOKED, client_profile_id: CLIENT, status: "revoked" },
      { id: "cc-stranger", coach_profile_id: STRANGER, client_profile_id: OTHER_CLIENT, status: "active" },
      // A converted prospect with no SIGNAL account yet: relationship only.
      { id: "cc-prospect", coach_profile_id: LEAD, client_profile_id: null, status: "active" },
    ],
    coach_delegates: [
      { delegate_coach_profile_id: DELEGATE, principal_coach_profile_id: LEAD, status: "active" },
    ],
    coach_tasks: [],
    coach_task_events: [],
    coach_automation_events: [],
    coach_automation_rules: [],
    coach_task_templates: [],
    ...extra,
  })
}

const events = (db: ReturnType<typeof seed>, taskId: string) =>
  db.tables.coach_task_events.filter((e) => e.task_id === taskId).map((e) => e.kind)

async function main() {
  // Silence the History logger, which uses its own admin client and warns
  // (by design, without throwing) when there is no database to write to.
  const warn = console.warn
  console.warn = () => {}

  console.log("fix 2: system tasks go through createTask")
  {
    const db = seed()
    const id = await raiseCoachTask(db.client, {
      coachClientId: "cc-lead", clientProfileId: CLIENT, assigneeProfileId: LEAD,
      title: "Client finished Session 1 homework", link: "/dashboard/coach/clients/client-1",
    })
    const row = db.tables.coach_tasks.find((t) => t.id === id)
    ok("a task is created", !!row)
    ok("as a system task", row?.source === "auto")
    ok("with no author", row?.created_by_profile_id === null)
    ok("and its audit event is written, which the raw insert never did", id !== null && events(db, id!).includes("created"))

    const refused = await raiseCoachTask(db.client, {
      coachClientId: "cc-lead", clientProfileId: CLIENT, assigneeProfileId: CLIENT,
      title: "x", link: "/dashboard/coach/clients/client-1",
    })
    ok("a non-coach assignee is refused now, which the raw insert allowed", refused === null)
  }
  {
    // A converted prospect with no SIGNAL account: its invite task now opens
    // the post-conversion page instead of /clients/null.
    const db = seed()
    const link = "/dashboard/coach/coach-clients/cc-prospect"
    ok("the prospect invite link is a valid task link", cleanTaskLink(link) === link)
    const made = await createTask(db.client, { title: "Send SIGNAL invite to Eva", coach_client_id: "cc-prospect",
      client_profile_id: null, assignee_profile_id: LEAD, source: "auto", link }, LEAD)
    ok("and a prospect-only invite task is created for its coach", made.ok, made.ok ? "" : made.error)
  }

  console.log("\nfix 3: feedback closes the practice task, found by its link")
  {
    const db = seed({
      coach_tasks: [
        { id: "t-round", coach_client_id: "cc-lead", client_profile_id: CLIENT, assignee_profile_id: LEAD,
          status: "open", source: "auto", link: practiceRoundLink("round-1"), deleted_at: null,
          description: "Client recorded 5 answers.", title: "Watch Client's practice round" },
        { id: "t-other", coach_client_id: "cc-lead", client_profile_id: CLIENT, assignee_profile_id: LEAD,
          status: "open", source: "auto", link: practiceRoundLink("round-2"), deleted_at: null, title: "Another round" },
      ],
    })
    const closed = await closePracticeRoundTask(db.client, { id: "round-1", coach_client_id: "cc-lead" }, LEAD)
    ok("exactly one task closed", closed === 1)
    ok("the round's own task is done", db.tables.coach_tasks.find((t) => t.id === "t-round")?.status === "done")
    ok("another round's task is untouched", db.tables.coach_tasks.find((t) => t.id === "t-other")?.status === "open")
    ok("closed through setTaskStatus: a completed event", events(db, "t-round").includes("completed"))
    ok("and a task.completed automation event",
      db.tables.coach_automation_events.some((e) => e.event_key === "task.completed" && e.payload?.task_id === "t-round"))
    ok("a second send closes nothing", (await closePracticeRoundTask(db.client, { id: "round-1", coach_client_id: "cc-lead" }, LEAD)) === 0)
  }

  console.log("\nfix 4: an event is claimed once")
  {
    const now = new Date("2026-09-29T12:00:00Z")
    const db = seed({
      coach_automation_events: [
        { id: "e-free", event_key: "noop", payload: {}, occurred_at: "2026-09-29T11:00:00Z", processed_at: null, claimed_at: null },
        { id: "e-stale", event_key: "noop", payload: {}, occurred_at: "2026-09-29T11:01:00Z", processed_at: null,
          claimed_at: new Date(now.getTime() - CLAIM_TTL_MS - 1000).toISOString() },
        { id: "e-done", event_key: "noop", payload: {}, occurred_at: "2026-09-29T11:02:00Z",
          processed_at: "2026-09-29T11:03:00Z", claimed_at: null },
      ],
    })
    ok("the first runner gets a free event", await claimEvent(db.client, "e-free", now))
    ok("a second runner does not", !(await claimEvent(db.client, "e-free", now)))
    ok("a claim older than the window can be taken over", await claimEvent(db.client, "e-stale", now))
    ok("a processed event cannot be claimed", !(await claimEvent(db.client, "e-done", now)))
  }
  {
    const db = seed({
      coach_automation_events: [
        { id: "e-mine", event_key: "noop", payload: {}, occurred_at: "2026-09-29T11:00:00Z", processed_at: null, claimed_at: null },
        { id: "e-theirs", event_key: "noop", payload: {}, occurred_at: "2026-09-29T11:01:00Z", processed_at: null,
          claimed_at: new Date().toISOString() },
      ],
    })
    const ran = await runPending(db.client)
    ok("the queue runs the unclaimed event", ran.map((r) => r.eventId).join() === "e-mine")
    ok("and leaves one another runner holds alone",
      db.tables.coach_automation_events.find((e) => e.id === "e-theirs")?.processed_at === null)
  }

  console.log("\nfix 4: two coaches ticking one task advance the chain once")
  {
    const db = seed({
      coach_tasks: [{ id: "t-1", coach_client_id: "cc-lead", client_profile_id: CLIENT, assignee_profile_id: LEAD,
        status: "open", completed_at: null, source: "manual", deleted_at: null, title: "T" }],
    })
    // The other coach's tick lands between our read and our write.
    db.beforeNextUpdate("coach_tasks", () => {
      Object.assign(db.tables.coach_tasks[0], { status: "done", completed_at: new Date().toISOString() })
    })
    const r = await setTaskStatus(db.client, "t-1", "done", DELEGATE)
    ok("our tick succeeds as a no-op", r.ok)
    ok("no second completed event", events(db, "t-1").filter((k) => k === "completed").length === 0)
    ok("no second task.completed", db.tables.coach_automation_events.length === 0)
  }
  {
    const db = seed({
      coach_tasks: [{ id: "t-1", coach_client_id: "cc-lead", client_profile_id: CLIENT, assignee_profile_id: LEAD,
        status: "open", completed_at: null, source: "manual", deleted_at: null, title: "T" }],
    })
    db.beforeNextUpdate("coach_tasks", () => { db.tables.coach_tasks[0].status = "cancelled" })
    const r = await setTaskStatus(db.client, "t-1", "done", LEAD)
    ok("a different change in between is reported, not overwritten", !r.ok && r.status === 409)
  }

  console.log("\nfix 5: ownership needs an active relationship")
  {
    const db = seed()
    ok("the active lead coach owns it", await isCoachClientOwnedByCoach(db.client, LEAD, "cc-lead"))
    ok("their delegate does too", await isCoachClientOwnedByCoach(db.client, DELEGATE, "cc-lead"))
    ok("a prospect relationship (active) still works", await isCoachClientOwnedByCoach(db.client, LEAD, "cc-prospect"))
    ok("a revoked coach no longer does", !(await isCoachClientOwnedByCoach(db.client, REVOKED, "cc-revoked")))
    ok("a stranger never did", !(await isCoachClientOwnedByCoach(db.client, STRANGER, "cc-lead")))
  }

  console.log("\nfix 6: a task goes only to a coach who can open its client")
  {
    const db = seed()
    const who = await coachesWhoCanReach(db.client, { client_profile_id: CLIENT })
    ok("reach = the lead and their delegate", !!who && who.size === 2 && who.has(LEAD) && who.has(DELEGATE))
    ok("a prospect relationship reaches its coach",
      !!(await coachesWhoCanReach(db.client, { coach_client_id: "cc-prospect" }))?.has(LEAD))
    ok("a task with no client has no limit", (await coachesWhoCanReach(db.client, {})) === null)

    const toStranger = await createTask(db.client, { title: "T", client_profile_id: CLIENT, assignee_profile_id: STRANGER }, LEAD)
    ok("assigning to a stranger is refused", !toStranger.ok && toStranger.error === UNREACHABLE_ASSIGNEE)
    const toRevoked = await createTask(db.client, { title: "T", client_profile_id: CLIENT, assignee_profile_id: REVOKED }, LEAD)
    ok("assigning to a revoked coach is refused", !toRevoked.ok)
    const toDelegate = await createTask(db.client, { title: "T", client_profile_id: CLIENT, assignee_profile_id: DELEGATE }, LEAD)
    ok("assigning to the delegate is allowed", toDelegate.ok)
    const noClient = await createTask(db.client, { title: "Renew the domain", assignee_profile_id: STRANGER }, LEAD)
    ok("a task with no client can go to anyone", noClient.ok)

    if (toDelegate.ok) {
      const re = await reassignTask(db.client, toDelegate.data.id, STRANGER, LEAD)
      ok("reassigning to a stranger is refused", !re.ok && re.error === UNREACHABLE_ASSIGNEE)
      const re2 = await reassignTask(db.client, toDelegate.data.id, LEAD, DELEGATE)
      ok("reassigning to the lead is allowed", re2.ok)
      const moved = await updateTask(db.client, toDelegate.data.id, { client_profile_id: OTHER_CLIENT, coach_client_id: null }, LEAD)
      ok("moving it to a client the assignee cannot open is refused", !moved.ok)
    }
  }

  console.log("\nfix 6: the chain falls back to the client's coach")
  {
    const db = seed({
      coach_task_templates: [{ id: "tmpl-1", key: "networking.create_campaign", title: "Create Networking Campaign",
        default_assignee_profile_id: STRANGER, due_offset_days: 1, active: true, link_template: null }],
      coach_automation_rules: [{ id: "rule-1", event_key: "campaign_brief.submitted", action: "create_task",
        template_id: "tmpl-1", condition: {}, active: true, sort_order: 1 }],
    })
    const ev = { id: "ev-1", event_key: "campaign_brief.submitted", payload: { coach_client_id: "cc-lead", brief_id: "b-1" },
      client_profile_id: CLIENT, occurred_at: new Date().toISOString() }
    db.tables.coach_automation_events.push({ ...ev, processed_at: null })
    const r = await runEvent(db.client, ev as any)
    const task = db.tables.coach_tasks[0]
    ok("the step is still created", r.outcome === "created", r.detail)
    ok("assigned to the client's own coach, not the default", task?.assignee_profile_id === LEAD)
  }
  {
    const db = seed({
      coach_clients: [{ id: "cc-orphan", coach_profile_id: "gone", client_profile_id: CLIENT, status: "revoked" }],
      coach_task_templates: [{ id: "tmpl-1", key: "networking.create_campaign", title: "Create Networking Campaign",
        default_assignee_profile_id: STRANGER, due_offset_days: 1, active: true, link_template: null }],
      coach_automation_rules: [{ id: "rule-1", event_key: "campaign_brief.submitted", action: "create_task",
        template_id: "tmpl-1", condition: {}, active: true, sort_order: 1 }],
    })
    const ev = { id: "ev-2", event_key: "campaign_brief.submitted", payload: { coach_client_id: "cc-orphan" },
      client_profile_id: CLIENT, occurred_at: new Date().toISOString() }
    db.tables.coach_automation_events.push({ ...ev, processed_at: null })
    const r = await runEvent(db.client, ev as any)
    ok("with nobody to take it, the event is an error", r.outcome === "error")
    ok("that says why in a sentence", String(r.detail).includes("Assign the task by hand"), r.detail)
    ok("and no task is created", db.tables.coach_tasks.length === 0)
  }

  console.warn = warn
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main()
