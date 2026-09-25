// tests/automation/chain-smoke.ts
//
// Drives the Networking chain end to end against a real database.
//
// The engine is worth nothing if the chain does not actually walk, and the
// parts that can only fail against real data are the ones worth testing: the
// rules matching on a decision, the reopen carrying its note, the two
// auto-completions, and the no-op when nothing is open.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx tests/automation/chain-smoke.ts
//
// Creates a brief on a real coach-client relationship, walks it, and removes
// everything it made. POINT IT AT DEV.

import { createClient } from "@supabase/supabase-js"
import { drain } from "../../lib/automation/run"
import { emitTaskEvent, setTaskStatus } from "../../lib/tasks/service"

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
const db = createClient(url, key, { auth: { persistSession: false } })

let failures = 0
const ck = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? "   " + detail : ""}`)
  if (!ok) failures++
}

/** Every task on the brief, whatever its status. */
const allTasksFor = async (briefId: string) =>
  (await db.from("coach_tasks")
    .select("id, status, template_id, chain_id, decision, due_at")
    .eq("brief_id", briefId).is("deleted_at", null)
    .order("created_at", { ascending: true })).data ?? []

/**
 * The OPEN ones. After a Request Changes round the brief carries two review
 * tasks, one done and one open, and acting on the done one is a no-op the
 * engine is right to refuse.
 */
const openTasks = async (briefId: string) =>
  (await allTasksFor(briefId)).filter((t: any) => t.status === "open")

async function titleOf(templateId: string | null): Promise<string> {
  if (!templateId) return "(none)"
  const { data } = await db.from("coach_task_templates").select("key").eq("id", templateId).maybeSingle()
  return data?.key ?? "(unknown)"
}

async function main() {
  console.log(`project: ${new URL(url!).hostname.split(".")[0]}\n`)

  const { data: rel } = await db.from("coach_clients")
    .select("id, client_profile_id").eq("status", "active").not("client_profile_id", "is", null).limit(1).maybeSingle()
  if (!rel) throw new Error("No active coach-client relationship to test with")

  // ---- a brief, submitted
  const { data: brief, error: bErr } = await db.from("networking_campaign_briefs").insert({
    coach_client_id: rel.id,
    client_profile_id: rel.client_profile_id,
    name: "SMOKE campaign",
    status: "submitted",
    submitted_at: new Date().toISOString(),
    primary_roles: ["analyst"],
    locations: ["New York"],
  }).select("*").single()
  if (bErr) throw new Error(`brief insert: ${bErr.message}`)
  console.log(`brief ${brief.id} on relationship ${rel.id}\n`)

  await emitTaskEvent(db, "campaign_brief.submitted", {
    brief_id: brief.id, coach_client_id: rel.id,
  }, rel.client_profile_id)

  // ---- 1. submit -> Create Networking Campaign
  await drain(db)
  let tasks = await openTasks(brief.id)
  ck("submit creates one task", tasks.length === 1, await titleOf(tasks[0]?.template_id))
  ck("it is Create Networking Campaign", (await titleOf(tasks[0]?.template_id)) === "networking.create_campaign")
  ck("it carries the brief and a chain", !!tasks[0]?.chain_id)
  ck("due date defaults to +1 day", !!tasks[0]?.due_at &&
    Math.round((new Date(tasks[0].due_at!).getTime() - Date.now()) / 864e5) === 1,
    String(tasks[0]?.due_at).slice(0, 10))

  // ---- 2. complete it -> Review Networking Campaign
  const createTaskId = tasks[0].id
  await setTaskStatus(db, createTaskId, "done", null)
  await drain(db)
  tasks = await openTasks(brief.id)
  const reviewTask = (await Promise.all(tasks.map(async (t) => ({ t, k: await titleOf(t.template_id) }))))
    .find((x) => x.k === "networking.review_campaign")?.t
  ck("completing task 1 creates the review", !!reviewTask)

  // ---- 3. Request Changes -> task 1 reopens, with the note
  await setTaskStatus(db, reviewTask!.id, "done", null, {
    decision: "request_changes", note: "Please add five more fintech contacts.",
  })
  await drain(db)
  const { data: reopened } = await db.from("coach_tasks").select("status").eq("id", createTaskId).single()
  ck("Request Changes reopens task 1", reopened?.status === "open")
  const { data: ev } = await db.from("coach_task_events")
    .select("kind, note").eq("task_id", createTaskId).eq("kind", "reopened").maybeSingle()
  ck("the reopen carries the note", ev?.note?.includes("fintech") === true, ev?.note ?? "")

  // ---- 4. round two: complete, then Approve -> build task
  await setTaskStatus(db, createTaskId, "done", null)
  await drain(db)
  const review2 = (await Promise.all((await openTasks(brief.id)).map(async (t) => ({ t, k: await titleOf(t.template_id) }))))
    .filter((x) => x.k === "networking.review_campaign").map((x) => x.t)
  ck("a second review task exists", review2.length >= 1)

  await setTaskStatus(db, review2[0].id, "done", null, { decision: "approve" })
  await drain(db)
  let keys = await Promise.all((await openTasks(brief.id)).map((t) => titleOf(t.template_id)))
  ck("Approve creates Upload and Build", keys.includes("networking.upload_and_build"))

  // ---- 5. plan generated -> build auto-completes -> share appears
  const buildTask = (await Promise.all((await openTasks(brief.id)).map(async (t) => ({ t, k: await titleOf(t.template_id) }))))
    .find((x) => x.k === "networking.upload_and_build")!.t
  await emitTaskEvent(db, "networking_plan.generated", {
    chain_id: buildTask.chain_id, brief_id: brief.id,
  }, rel.client_profile_id)
  await drain(db)
  const { data: built } = await db.from("coach_tasks").select("status").eq("id", buildTask.id).single()
  ck("plan generated auto-completes the build task", built?.status === "done")
  keys = await Promise.all((await openTasks(brief.id)).map((t) => titleOf(t.template_id)))
  ck("and creates Share Plan with Client", keys.includes("networking.share_plan"))

  // ---- 6. shared -> share auto-completes
  const shareTask = (await Promise.all((await openTasks(brief.id)).map(async (t) => ({ t, k: await titleOf(t.template_id) }))))
    .find((x) => x.k === "networking.share_plan")!.t
  await emitTaskEvent(db, "networking_plan.shared", {
    chain_id: shareTask.chain_id, brief_id: brief.id,
  }, rel.client_profile_id)
  await drain(db)
  const { data: shared } = await db.from("coach_tasks").select("status").eq("id", shareTask.id).single()
  ck("share auto-completes", shared?.status === "done")

  // ---- 7. the cutover case: an event with nothing open must no-op, not throw
  await emitTaskEvent(db, "networking_plan.shared", {
    chain_id: shareTask.chain_id, brief_id: brief.id,
  }, rel.client_profile_id)
  const res = await drain(db)
  const last = res[res.length - 1]
  ck("a second share event is a recorded no-op", last?.outcome === "no_match", last?.detail ?? "")
  const { data: noMatchRow } = await db.from("coach_automation_events")
    .select("processed_at, outcome, error").eq("id", last!.eventId).single()
  ck("the no-op is marked processed, not left queued", !!noMatchRow?.processed_at)
  ck("and is not recorded as an error", noMatchRow?.error === null)

  // ---- 8. nothing left unprocessed
  const { count: stuck } = await db.from("coach_automation_events")
    .select("*", { count: "exact", head: true }).is("processed_at", null)
  ck("the queue drained", (stuck ?? 0) === 0, `${stuck} unprocessed`)

  // ---- clean up everything this run made
  const ids = (await openTasks(brief.id)).map((t) => t.id)
  for (const t of await allTasksFor(brief.id)) await db.from("coach_task_events").delete().eq("task_id", t.id)
  await db.from("coach_tasks").delete().eq("brief_id", brief.id)
  await db.from("coach_automation_events").delete().eq("client_profile_id", rel.client_profile_id)
    .in("event_key", ["campaign_brief.submitted", "networking_plan.generated", "networking_plan.shared"])
  await db.from("networking_campaign_briefs").delete().eq("id", brief.id)
  const { count: left } = await db.from("coach_tasks")
    .select("*", { count: "exact", head: true }).eq("brief_id", brief.id)
  ck("cleaned up after itself", (left ?? 0) === 0, `${ids.length} tasks removed`)

  console.log(failures === 0 ? "\nChain walks end to end." : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
