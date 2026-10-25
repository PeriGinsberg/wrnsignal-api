/**
 * Read-only preflight for the job-sourcing prod rollout. Shell env first, else .env.phase0.
 * Counts count-shaped locations (where the TS fingerprint mirror and an
 * un-migrated ingest_norm_location disagree) and probes the exact objects each
 * rollout step creates.
 */
import { readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { fingerprintOf } from "../../lib/ingest/fingerprint"
const env: Record<string, string> = {}
for (const l of readFileSync(join(__dirname, "..", "..", ".env.phase0"), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) if (process.env[k]) env[k] = process.env[k]!
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
;(async () => {
  console.log("project:", new URL(env.SUPABASE_URL).hostname.split(".")[0])
  const rows: any[] = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("postings").select("title,company,location,fingerprint").order("id").range(f, f + 999)
    if (error) throw error
    rows.push(...(data || [])); if (!data || data.length < 1000) break
  }
  const counted = rows.filter((r) => /^\s*\d+\s+locations?\s*$/i.test(r.location || ""))
  const mismatch = rows.filter((r) => fingerprintOf(r) !== r.fingerprint)
  console.log(`postings ${rows.length}; count-shaped locations ${counted.length}; TS-vs-stored fingerprint mismatches ${mismatch.length}`)
  for (const r of mismatch.slice(0, 5)) console.log(`   ${r.company} | ${r.title} | ${JSON.stringify(r.location)}`)
  for (const [t, c] of [["ingest_pairs", "sources"], ["ingest_pairs", "campus"], ["postings", "title_norm"], ["postings", "last_seen_elsewhere_at"]]) {
    const { error } = await sb.from(t).select(c).limit(1)
    console.log(`  ${t}.${c}: ${error ? "absent (" + error.code + ")" : "present"}`)
  }
  for (const t of ["employer_aliases", "posting_links", "posting_link_runs"]) {
    const { error } = await sb.from(t).select("*").limit(1)
    console.log(`  ${t}: ${error ? "absent (" + error.code + ")" : "present"}`)
  }
})()
