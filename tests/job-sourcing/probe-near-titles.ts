/** Read-only: other-source titles near the 3 serpapi postings whose employer overlaps. */
import { readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
const env: Record<string, string> = {}
for (const l of readFileSync(join(__dirname, "..", "..", ".env.phase0"), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
;(async () => {
  for (const [co, t] of [["point72", "%financial analyst%"], ["huntington", "%private bank%"], ["allstate", "%financial analyst%"]]) {
    const { data } = await sb.from("postings").select("source,company,title,location").neq("source", "serpapi").ilike("company", `%${co}%`).ilike("title", t)
    console.log(co, t, "->", (data || []).map((r) => `${r.source}: ${r.title} | ${r.location}`).join("  ;  ") || "none")
  }
})()
