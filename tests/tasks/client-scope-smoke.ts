// tests/tasks/client-scope-smoke.ts
//
// Does "this client's tasks" actually mean every task tied to this client?
//
// WHY THIS NEEDS A REAL DATABASE. The question is entirely about how PostgREST
// resolves an `or()` over two columns, and whether a second `or()` on the same
// query (the search filter) ANDs with the first or replaces it. Both have bitten
// this repo before: an `or()` with `%` instead of `*` under-returned silently,
// and Needs Your Attention matching one column alone hid a real task while
// looking perfectly healthy.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx tests/tasks/client-scope-smoke.ts
//
// Read-only except for the three tasks it creates and deletes. POINT IT AT DEV.

import { createClient } from "@supabase/supabase-js"
import { clientTaskFilter, coachClientIdForTask } from "../../lib/tasks/scope"

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
const db = createClient(url, key, { auth: { persistSession: false } })

let failures = 0
const ck = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? "   " + detail : ""}`)
  if (!ok) failures++
}

async function main() {
  console.log(`project: ${new URL(url!).hostname.split(".")[0]}\n`)

  const { data: rel } = await db.from("coach_clients")
    .select("id, client_profile_id, coach_profile_id").eq("status", "active")
    .not("client_profile_id", "is", null).limit(1).maybeSingle()
  if (!rel) throw new Error("No active coach-client relationship to test with")
  const clientId = rel.client_profile_id as string

  const made: string[] = []
  const insert = async (title: string, cols: Record<string, unknown>) => {
    const { data, error } = await db.from("coach_tasks").insert({
      title, assignee_profile_id: rel.coach_profile_id, status: "open", source: "manual", ...cols,
    }).select("id").single()
    if (error) throw new Error(`${title}: ${error.message}`)
    made.push(data.id)
    return data.id as string
  }

  // The three shapes that exist in production.
  const bothIds = await insert("SCOPE both ids", { client_profile_id: clientId, coach_client_id: rel.id })
  const clientOnly = await insert("SCOPE client only", { client_profile_id: clientId, coach_client_id: null })
  const ccOnly = await insert("SCOPE relationship only", { client_profile_id: null, coach_client_id: rel.id })

  const filter = (await clientTaskFilter(db, clientId))!
  console.log(`filter: ${filter}\n`)

  const { data: found, error } = await db.from("coach_tasks")
    .select("id, title").or(filter).eq("status", "open").is("deleted_at", null)
  if (error) throw new Error(`or() failed: ${error.message}`)
  const ids = new Set((found ?? []).map((t) => t.id))

  ck("a task with both ids is found", ids.has(bothIds))
  ck("a task with only client_profile_id is found", ids.has(clientOnly),
    "the shape that was invisible in Needs Your Attention")
  ck("a task with only coach_client_id is found", ids.has(ccOnly),
    "the prospect-era shape, 25 of them on prod")

  // Another client's task must NOT come back: an or() that widened too far
  // would look like a fix and leak one coach's list into another's page.
  const { data: other } = await db.from("coach_clients")
    .select("id, client_profile_id").eq("status", "active")
    .not("client_profile_id", "is", null).neq("client_profile_id", clientId).limit(1).maybeSingle()
  if (other) {
    const foreign = await insert("SCOPE another client", {
      client_profile_id: other.client_profile_id, coach_client_id: other.id,
    })
    const { data: again } = await db.from("coach_tasks")
      .select("id").or(filter).eq("status", "open").is("deleted_at", null)
    ck("another client's task is NOT found", !(again ?? []).some((t) => t.id === foreign))
  }

  // THE SECOND or(). The tasks route applies the client filter and then a
  // search filter; two or() calls must AND, not replace.
  const { data: searched } = await db.from("coach_tasks")
    .select("id, title").or(filter)
    .or("title.ilike.*relationship only*,description.ilike.*relationship only*")
    .eq("status", "open").is("deleted_at", null)
  const searchIds = (searched ?? []).map((t) => t.id)
  ck("client filter AND search, not one replacing the other",
    searchIds.length === 1 && searchIds[0] === ccOnly,
    `${searchIds.length} row(s)`)

  // The write-path half.
  const resolved = await coachClientIdForTask(db, clientId)
  ck("the write path resolves a relationship for this client", resolved === rel.id, String(resolved))

  for (const id of made) await db.from("coach_task_events").delete().eq("task_id", id)
  const { error: delErr } = await db.from("coach_tasks").delete().in("id", made)
  ck("cleaned up after itself", !delErr, delErr?.message ?? `${made.length} removed`)

  console.log(failures === 0 ? "\nEvery task tied to a client is found." : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
