// tests/tasks/service-smoke.ts
//
// Exercises lib/tasks/service.ts against a real database: the constraints, the
// audit trail and the automation queue are the things worth testing, and none
// of them exist in a mock.
//
// Creates its own rows and removes them again, so it can be run repeatedly.
// Credentials come from process.env; this file never reads a .env file.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx tests/tasks/service-smoke.ts
//
// POINT IT AT DEV. It writes.

import { createClient } from "@supabase/supabase-js"
import { cardTasks, isOverdue, type Task } from "../../lib/tasks/model"
import {
  assertAssignableCoach,
  createTask,
  deleteTask,
  reassignTask,
  setTaskStatus,
} from "../../lib/tasks/service"

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")

const db = createClient(url, key, { auth: { persistSession: false } })

let failures = 0
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${label}${detail ? "  " + detail : ""}`)
  if (!cond) failures++
}

async function main() {
  console.log(`project: ${new URL(url!).hostname.split(".")[0]}`)

  const { data: coaches } = await db.from("client_profiles").select("id, name").eq("is_coach", true).limit(2)
  const { data: nonCoach } = await db.from("client_profiles").select("id, name").eq("is_coach", false).limit(1)
  if (!coaches?.length) throw new Error("No coach profiles to assign to")
  const coachA = coaches[0]
  const coachB = coaches[1] ?? coaches[0]

  console.log(`\ncoachA=${coachA.name}  coachB=${coachB.name}  nonCoach=${nonCoach?.[0]?.name ?? "(none)"}`)

  // ---- the assignee rule
  const good = await assertAssignableCoach(db, coachA.id)
  check("a coach is assignable", good.ok)
  if (nonCoach?.[0]) {
    const bad = await assertAssignableCoach(db, nonCoach[0].id)
    check("a non-coach is refused", !bad.ok, bad.ok ? "" : `-> "${bad.error}"`)
  }

  // ---- create
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const created = await createTask(db, {
    title: "SMOKE: overdue task",
    description: "Created by tests/tasks/service-smoke.ts",
    assignee_profile_id: coachA.id,
    due_at: yesterday,
    due_has_time: false,
  }, coachA.id)
  check("create returns a task", created.ok)
  if (!created.ok) { console.error(created.error); process.exit(1) }
  const task = created.data

  check("status defaults to open", task.status === "open", task.status)
  check("source defaults to manual", task.source === "manual", task.source)
  check("it reads as overdue", isOverdue(task))

  const { data: ev1 } = await db.from("coach_task_events").select("kind").eq("task_id", task.id)
  check("a created event was written", (ev1 ?? []).some((e) => e.kind === "created"))

  // ---- the card picks it up
  const { data: mine } = await db.from("coach_tasks")
    .select("*").eq("assignee_profile_id", coachA.id).is("deleted_at", null)
  const { shown, total } = cardTasks((mine ?? []) as unknown as Task[])
  check("the card includes it", shown.some((t) => t.id === task.id), `total=${total}`)
  check("the card caps at five", shown.length <= 5, `shown=${shown.length}`)

  // ---- reassign
  const re = await reassignTask(db, task.id, coachB.id, coachA.id, "smoke handover")
  check("reassign succeeds", re.ok && re.data.assignee_profile_id === coachB.id)
  const { data: ev2 } = await db.from("coach_task_events").select("kind, payload").eq("task_id", task.id)
  const reassigned = (ev2 ?? []).find((e) => e.kind === "reassigned")
  check("reassign is audited with from and to",
    !!reassigned && (reassigned.payload as any)?.to === coachB.id)

  if (nonCoach?.[0]) {
    const badRe = await reassignTask(db, task.id, nonCoach[0].id, coachA.id)
    check("reassign to a non-coach is refused", !badRe.ok)
  }

  // ---- complete, and the automation event
  const before = await db.from("coach_automation_events").select("id", { count: "exact", head: true })
    .eq("event_key", "task.completed")
  const done = await setTaskStatus(db, task.id, "done", coachA.id, { decision: "approve" })
  check("complete succeeds", done.ok)
  check("completed_at is set with the status", done.ok && !!done.data.completed_at)
  check("a completed task is not overdue", done.ok && !isOverdue(done.data))

  const after = await db.from("coach_automation_events").select("id", { count: "exact", head: true })
    .eq("event_key", "task.completed")
  check("one task.completed event was queued", (after.count ?? 0) === (before.count ?? 0) + 1,
    `${before.count} -> ${after.count}`)

  // ---- completing twice must not fire the chain twice
  const again = await setTaskStatus(db, task.id, "done", coachA.id)
  const after2 = await db.from("coach_automation_events").select("id", { count: "exact", head: true })
    .eq("event_key", "task.completed")
  check("completing an already-done task is a no-op", again.ok && (after2.count ?? 0) === (after.count ?? 0),
    `${after.count} -> ${after2.count}`)

  // ---- delete
  const del = await deleteTask(db, task.id, coachA.id)
  check("delete succeeds", del.ok)
  const { data: gone } = await db.from("coach_tasks").select("deleted_at").eq("id", task.id).maybeSingle()
  check("it is soft-deleted, not removed", !!gone?.deleted_at)

  // ---- clean up everything this run made
  await db.from("coach_automation_events").delete().eq("event_key", "task.completed")
    .contains("payload", { task_id: task.id })
  await db.from("coach_tasks").delete().eq("id", task.id)
  const { data: left } = await db.from("coach_tasks").select("id").eq("id", task.id).maybeSingle()
  check("cleaned up after itself", !left)

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
