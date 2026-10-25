/** Read-only: active ingest_boards per source and active pairs by scope on the .env.phase0 project. */
import { readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
const env: Record<string, string> = {}
for (const l of readFileSync(join(__dirname, "..", "..", ".env.phase0"), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
;(async () => {
  const { data: b } = await sb.from("ingest_boards").select("source,active")
  const per: Record<string, number> = {}; for (const x of b || []) if (x.active) per[x.source] = (per[x.source] || 0) + 1
  console.log("active boards:", per)
  const { data: p } = await sb.from("ingest_pairs").select("title,location,active,sources").eq("active", true)
  console.log("active pairs:", (p || []).map((x) => `${x.title}|${x.location ?? "-"}|${x.sources ? x.sources.join(",") : "ALL"}`))
})()
