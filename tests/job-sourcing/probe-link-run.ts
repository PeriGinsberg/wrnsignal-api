/** Read-only: latest posting_link_runs row and posting_links size on the .env.phase0 project. */
import { readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
const env: Record<string, string> = {}
for (const l of readFileSync(join(__dirname, "..", "..", ".env.phase0"), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
;(async () => {
  const { data: run } = await sb.from("posting_link_runs").select("id,mode,triggered_by,status,postings_scanned,proposed_count,ambiguous_count,near_miss_count,written_count,removed_count,tier_counts,duration_ms,proposed").order("started_at", { ascending: false }).limit(1).single()
  const { proposed, ...rest } = run as any
  console.log("latest run:", JSON.stringify(rest))
  console.log("proposed stored in log:", (proposed || []).length)
  const { count } = await sb.from("posting_links").select("secondary_id", { count: "exact", head: true })
  console.log("posting_links rows:", count)
  const { count: p } = await sb.from("postings").select("id", { count: "exact", head: true })
  const { count: c } = await sb.from("postings_canonical").select("id", { count: "exact", head: true })
  console.log(`postings ${p}, postings_canonical ${c}`)
})()
