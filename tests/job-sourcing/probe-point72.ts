/** Read-only: Point72's Greenhouse rows on the .env.phase0 project, New York first. */
import { readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
const env: Record<string, string> = {}
for (const l of readFileSync(join(__dirname, "..", "..", ".env.phase0"), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
;(async () => {
  const { data } = await sb.from("postings").select("title,company,location,apply_url,last_seen_at").eq("source", "grnhse").eq("org_slug", "point72").order("title")
  const rows = data || []
  console.log(`point72 grnhse rows: ${rows.length}; company spellings: ${[...new Set(rows.map((r) => r.company))].join(" / ")}`)
  const locs: Record<string, number> = {}; for (const r of rows) locs[r.location] = (locs[r.location] || 0) + 1
  console.log("locations:", locs)
  for (const r of rows.filter((r) => /new york/i.test(r.location || ""))) console.log(`  ${r.title} | ${r.location} | seen ${r.last_seen_at.slice(0, 10)}`)
})()
