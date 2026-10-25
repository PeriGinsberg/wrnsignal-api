/** Read-only: Greenhouse rows whose last_seen_at is after --after (default 2026-10-01), plus the board's last crawl. */
import { readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
const env: Record<string, string> = {}
for (const l of readFileSync(join(__dirname, "..", "..", ".env.phase0"), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const i = process.argv.indexOf("--after"); const after = i >= 0 ? process.argv[i + 1] : "2026-10-01"
;(async () => {
  const { data } = await sb.from("postings").select("id,org_slug,source_job_id,title,first_seen_at,last_seen_at,last_seen_elsewhere_at").eq("source", "grnhse").gt("last_seen_at", after)
  console.log(`grnhse rows with last_seen_at > ${after}: ${(data || []).length}`)
  for (const r of data || []) console.log(`  ${r.org_slug} ${r.source_job_id} | ${r.title.trim()} | first ${r.first_seen_at} | last ${r.last_seen_at} | elsewhere ${r.last_seen_elsewhere_at}`)
  const { data: runs } = await sb.from("ingest_runs").select("created_at").eq("source", "grnhse").eq("org_slug", "point72").order("created_at", { ascending: false }).limit(1)
  console.log(`latest grnhse ingest_runs row for point72: ${runs?.[0]?.created_at ?? "none"}`)
})()
