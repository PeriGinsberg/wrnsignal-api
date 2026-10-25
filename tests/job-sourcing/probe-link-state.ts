/**
 * Read-only: the full posting_links table, checked against the latest
 * posting_link_runs proposal, plus postings_canonical. Prints a JSON snapshot
 * (--json) so two moments can be diffed.
 */
import { readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
const env: Record<string, string> = {}
for (const l of readFileSync(join(__dirname, "..", "..", ".env.phase0"), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
;(async () => {
  const { data: links } = await sb.from("posting_links").select("*").order("secondary_id")
  const { count: p } = await sb.from("postings").select("id", { count: "exact", head: true })
  const { count: c } = await sb.from("postings_canonical").select("id", { count: "exact", head: true })
  if (process.argv.includes("--json")) { console.log(JSON.stringify({ links, postings: p, canonical: c }, null, 1)); return }
  const { data: run } = await sb.from("posting_link_runs").select("mode,proposed").eq("status", "ok").order("started_at", { ascending: false }).limit(1).single()
  const proposed = new Set(((run as any).proposed || []).map((l: any) => `${l.secondary_id}>${l.primary_id}`))
  const stored = new Set((links || []).map((l: any) => `${l.secondary_id}>${l.primary_id}`))
  const secIds = (links || []).map((l: any) => l.secondary_id)
  const { data: secs } = await sb.from("postings").select("id,source").in("id", secIds)
  const { data: hidden } = await sb.from("postings_canonical").select("id").in("id", secIds)
  const priIds = (links || []).map((l: any) => l.primary_id)
  const { data: prisVisible } = await sb.from("postings_canonical").select("id").in("id", priIds)
  console.log(`latest ok run mode=${(run as any).mode}; posting_links ${stored.size}; postings ${p}; canonical ${c}`)
  console.log(`stored == latest proposal: ${stored.size === proposed.size && [...stored].every((x) => proposed.has(x))}`)
  console.log(`secondaries all serpapi: ${(secs || []).every((s: any) => s.source === "serpapi")}; secondaries in canonical: ${(hidden || []).length}; primaries still in canonical: ${(prisVisible || []).length}/${priIds.length}`)
  console.log(`tiers: ${JSON.stringify((links || []).reduce((m: any, l: any) => ((m[l.tier] = (m[l.tier] || 0) + 1), m), {}))}; rule_version ${[...new Set((links || []).map((l: any) => l.rule_version))].join(",")}`)
})()
