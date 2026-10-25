/** Read-only: confirm the Phase 1 migration + Alex seed on the .env.phase0 project. */
import { readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
const env: Record<string, string> = {}
for (const l of readFileSync(join(__dirname, "..", "..", ".env.phase0"), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
;(async () => {
  console.log("project:", new URL(env.SUPABASE_URL).hostname.split(".")[0])
  const { data: p, error } = await sb.from("ingest_pairs").select("title,location,campus,sources,active").contains("sources", ["serpapi"])
  console.log("serpapi pairs:", error ? "ERR " + error.message : p!.length, p?.every((x) => x.active && !x.campus) ? "(all active, none campus)" : "")
  const { data: all } = await sb.from("ingest_pairs").select("sources")
  console.log("pairs with sources NULL:", all?.filter((x) => x.sources === null).length, "of", all?.length)
  const { error: e } = await sb.from("employer_aliases").select("id").limit(1); console.log("employer_aliases:", e ? "ERR " + e.message : "exists")
  const bySource: Record<string, number> = {}
  for (let f = 0; ; f += 1000) { const { data } = await sb.from("postings").select("source").range(f, f + 999); for (const r of data || []) bySource[r.source] = (bySource[r.source] || 0) + 1; if (!data || data.length < 1000) break }
  console.log("postings by source:", bySource)
})()
