/** Read-only: what is in the ingest tables right now. Creds from .env.phase0. */
import { readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"

const env: Record<string, string> = {}
for (const l of readFileSync(join(__dirname, "..", "..", ".env.phase0"), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

;(async () => {
  const { data: pairs, error } = await sb.from("ingest_pairs").select("*").order("created_at")
  console.log("ingest_pairs err:", error?.message, "rows:", pairs?.length)
  if (pairs?.[0]) console.log("  columns:", Object.keys(pairs[0]).join(","))
  for (const p of pairs || []) console.log(" ", p.active ? "A" : "-", JSON.stringify(p.title), JSON.stringify(p.location))
  const { count } = await sb.from("postings").select("id", { count: "exact", head: true })
  console.log("postings rows:", count)
  const { data: r } = await sb.from("ingest_runs").select("source, created_at, status").order("created_at", { ascending: false }).limit(3)
  console.log("latest runs:", r)
  const { error: e } = await sb.from("employer_aliases").select("*").limit(1)
  console.log("employer_aliases:", e ? "ABSENT/err: " + e.code + " " + e.message : "EXISTS")
  const { data: pc } = await sb.from("postings").select("*").limit(1)
  console.log("postings cols:", pc?.[0] ? Object.keys(pc[0]).join(",") : "(no rows)")
  const { data: rc } = await sb.from("ingest_runs").select("*").limit(1)
  console.log("ingest_runs cols:", rc?.[0] ? Object.keys(rc[0]).join(",") : "(no rows)")
})()
