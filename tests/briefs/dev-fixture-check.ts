// tests/briefs/dev-fixture-check.ts
//
// Is this database ready to test a Campaign Brief against?
//
// Read-only. Answers the three questions that otherwise get found out halfway
// through a manual test: which clients have a coach and a profile worth
// prefilling from, whether the chain templates and rules are seeded, and how
// many briefs already exist.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx tests/briefs/dev-fixture-check.ts
//
// A client with a long profile_text and no target_locations is the most useful
// one to test with: the prefill fills roles, and the AI read has real work to
// do on everything else.

import { createClient } from "@supabase/supabase-js"

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
  const db = createClient(url, key, { auth: { persistSession: false } })
  console.log(`project: ${new URL(url).hostname.split(".")[0]}\n`)

  const { data: rels } = await db.from("coach_clients")
    .select("id, client_profile_id").eq("status", "active")
    .not("client_profile_id", "is", null).limit(40)
  const ids = (rels ?? []).map((r) => r.client_profile_id)
  const { data: profs } = await db.from("client_profiles")
    .select("id, name, target_roles, target_locations, profile_text").in("id", ids)

  console.log(`active coach-client relationships: ${rels?.length ?? 0}`)
  for (const r of rels ?? []) {
    const p = (profs ?? []).find((x) => x.id === r.client_profile_id)
    if (!p) continue
    const text = p.profile_text ? `${String(p.profile_text).length}ch` : "-"
    console.log(`  ${String(p.name ?? "?").padEnd(22)} ${p.id}  roles=${p.target_roles ? "yes" : "-"}  locations=${p.target_locations ? "yes" : "-"}  profile_text=${text}`)
  }

  const { data: tmpl } = await db.from("coach_task_templates").select("key, decision_options")
  console.log(`\ntemplates: ${(tmpl ?? []).map((t) => t.key).join(", ") || "NONE — run tests/automation/seed-networking-chain.ts"}`)

  const { count: rules } = await db.from("coach_automation_rules")
    .select("*", { count: "exact", head: true }).eq("active", true)
  console.log(`active rules: ${rules ?? 0}${(rules ?? 0) === 7 ? "" : "  (the Networking chain is 7)"}`)

  const { count: briefs } = await db.from("networking_campaign_briefs")
    .select("*", { count: "exact", head: true }).is("deleted_at", null)
  console.log(`briefs: ${briefs ?? 0}`)
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
