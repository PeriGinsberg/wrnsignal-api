/** Read-only: sample rows for companies matching --like, per source. Shell env first, else .env.phase0. */
import { readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
const env: Record<string, string> = {}
for (const l of readFileSync(join(__dirname, "..", "..", ".env.phase0"), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) if (process.env[k]) env[k] = process.env[k]!
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const like = process.argv[process.argv.indexOf("--like") + 1]
;(async () => {
  const { data, error } = await sb.from("postings").select("source,org_slug,company,title,location,apply_url").ilike("company", like).limit(400)
  if (error) throw error
  const bySrc = new Map<string, any[]>()
  for (const r of data || []) bySrc.set(r.source + "/" + r.org_slug + " [" + r.company + "]", [...(bySrc.get(r.source + "/" + r.org_slug + " [" + r.company + "]") || []), r])
  for (const [k, rs] of bySrc) {
    console.log(`${k}: ${rs.length} rows; e.g. ${rs[0].apply_url}`)
    for (const r of rs.slice(0, 6)) console.log(`   ${r.title} | ${r.location}`)
  }
})()
