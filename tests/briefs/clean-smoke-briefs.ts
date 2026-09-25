// tests/briefs/clean-smoke-briefs.ts
//
// Removes the rows chain-smoke.ts leaves behind when it fails partway.
//
// The smoke cleans up at the END of a successful run, so a run that throws in
// the middle leaves a "SMOKE campaign" brief, its tasks and its events in the
// database. They then show up on a real client's networking board, which is
// how they were noticed.
//
// ONLY ROWS NAMED "SMOKE campaign" ARE TOUCHED, and the counts are printed
// before anything is deleted, because a cleanup that reports nothing is
// indistinguishable from one that deleted the wrong thing.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx tests/briefs/clean-smoke-briefs.ts
//
// POINT IT AT DEV. It deletes.

import { createClient } from "@supabase/supabase-js"

const SMOKE_NAME = "SMOKE campaign"

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
  const db = createClient(url, key, { auth: { persistSession: false } })
  console.log(`project: ${new URL(url).hostname.split(".")[0]}\n`)

  const { data: briefs, error } = await db.from("networking_campaign_briefs")
    .select("id, name, client_profile_id, created_at").eq("name", SMOKE_NAME)
  if (error) throw new Error(`could not read briefs: ${error.message}`)
  if (!briefs?.length) { console.log("Nothing to clean."); return }

  const ids = briefs.map((b) => b.id)
  const { data: tasks } = await db.from("coach_tasks").select("id").in("brief_id", ids)
  const taskIds = (tasks ?? []).map((t) => t.id)

  console.log(`${briefs.length} smoke brief(s), ${taskIds.length} task(s):`)
  for (const b of briefs) console.log(`  ${b.id}  ${b.created_at}`)

  if (taskIds.length) {
    const { error: evErr } = await db.from("coach_task_events").delete().in("task_id", taskIds)
    if (evErr) throw new Error(`task events: ${evErr.message}`)
    const { error: tErr } = await db.from("coach_tasks").delete().in("brief_id", ids)
    if (tErr) throw new Error(`tasks: ${tErr.message}`)
  }

  const { error: bErr } = await db.from("networking_campaign_briefs").delete().in("id", ids)
  if (bErr) throw new Error(`briefs: ${bErr.message}`)

  // Checked, not assumed. A delete whose result nobody reads is the same shape
  // as one that silently matched nothing.
  const { count: left } = await db.from("networking_campaign_briefs")
    .select("*", { count: "exact", head: true }).eq("name", SMOKE_NAME)
  console.log(`\nRemoved. ${left ?? 0} smoke brief(s) remain.`)
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
