/** Read-only: how big-metro city names are spelled across postings (after the linker's city parse). */
import { readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { normText } from "../../lib/ingest/fingerprint"
const env: Record<string, string> = {}
for (const l of readFileSync(join(__dirname, "..", "..", ".env.phase0"), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) if (process.env[k]) env[k] = process.env[k]!
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const METRO = /\b(new york|nyc|manhattan|brooklyn|san francisco|sf|bay area|washington|dc|d c|los angeles|la|chicago|boston)\b/
;(async () => {
  const counts = new Map<string, number>()
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("postings").select("location").range(f, f + 999)
    if (error) throw error
    for (const r of data || []) for (const chunk of String(r.location || "").toLowerCase().split(/\s*(?:;|\||\/|\n|,|\bor\b|\band\b)\s*/)) {
      const t = normText(chunk); if (t && METRO.test(t) && t.split(" ").length <= 5) counts.set(t, (counts.get(t) || 0) + 1)
    }
    if (!data || data.length < 1000) break
  }
  for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(String(n).padStart(6), k)
})()
