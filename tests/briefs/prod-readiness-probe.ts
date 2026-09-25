// tests/briefs/prod-readiness-probe.ts
//
// What does this database already have, and what does it still need?
//
// Read-only. Probes the EXACT artifact each migration creates, not a similar
// adjacent one: a probe that checks a neighbouring table answers a different
// question and sends the deploy down the wrong path.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx tests/briefs/prod-readiness-probe.ts
//
// SELECTS A COLUMN, never a head-only count. `.select("*", {head:true,
// count:"exact"})` against a table PostgREST does not know returns
// `count:null, error:null`, which reads exactly like an empty table that
// exists. `.select("<column>")` returns PGRST205 and says so.

import { createClient } from "@supabase/supabase-js"

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
  const db = createClient(url, key, { auth: { persistSession: false } })
  console.log(`project: ${new URL(url).hostname.split(".")[0]}\n`)

  // [table, column, which migration creates it]
  const probes: [string, string, string][] = [
    ["coach_tasks", "id", "20260926_coach_tasks"],
    ["coach_task_events", "id", "20260926_coach_tasks"],
    ["coach_task_templates", "key", "20260926_coach_task_automation"],
    ["coach_automation_rules", "event_key", "20260926_coach_task_automation"],
    ["coach_automation_events", "event_key", "20260926_coach_task_automation"],
    ["networking_plan_sources", "source_hash", "20260926_plan_sources"],
    ["networking_plan_jobs", "client_email_sent_at", "20260926_plan_client_email"],
    ["networking_campaign_briefs", "id", "20260927_campaign_briefs"],
    ["coach_tasks", "brief_id", "20260927_campaign_briefs"],
    ["coach_tasks", "decision", "20260927_campaign_briefs"],
    ["networking_plan_jobs", "brief_id", "20260927_campaign_briefs"],
    ["networking_plan_sources", "brief_id", "20260927_campaign_briefs"],
  ]

  let missing = 0
  for (const [table, column, migration] of probes) {
    const { error } = await db.from(table).select(column).limit(1)
    const ok = !error
    if (!ok) missing++
    console.log(`  ${ok ? "present" : "MISSING"}  ${`${table}.${column}`.padEnd(42)} ${migration}${ok ? "" : `   ${error!.code ?? ""} ${error!.message}`}`)
  }

  // Row counts for the things a deploy has to seed, not just create.
  console.log("")
  for (const [table, label] of [
    ["coach_task_templates", "templates"],
    ["coach_automation_rules", "rules"],
    ["coach_tasks", "tasks"],
    ["networking_campaign_briefs", "briefs"],
  ] as [string, string][]) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true })
    console.log(`  ${label.padEnd(12)} ${error ? `(table not there)` : count}`)
  }

  console.log(missing ? `\n${missing} artifact(s) missing.` : "\nEverything probed is present.")
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
