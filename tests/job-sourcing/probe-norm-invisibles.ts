/**
 * Read-only pre-check for 20261026_ingest_norm_text_invisibles.sql, run from
 * TypeScript against the .env.phase0 project: recompute every posting's
 * fingerprint with the UPDATED mirror (lib/ingest/fingerprint.ts) and compare
 * with what the database has stored under the OLD rule.
 *
 *   rows changing   should be exactly the rows that contain an invisible char
 *   collisions      must be 0, or the migration's UNIQUE re-add will fail
 *   other mismatches  rows that change WITHOUT an invisible char: a mirror/SQL
 *                   disagreement that predates this change (parity problem)
 */
import { readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { fingerprintOf } from "../../lib/ingest/fingerprint"

const env: Record<string, string> = {}
for (const l of readFileSync(join(__dirname, "..", "..", ".env.phase0"), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const INVISIBLE = /[­͏؜᠎​-‏‪-‮⁠-⁯︀-️﻿]/

;(async () => {
  console.log("project:", new URL(env.SUPABASE_URL).hostname.split(".")[0])
  const rows: any[] = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("postings").select("id,source,title,company,location,fingerprint").order("id").range(f, f + 999)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  const withInvisible = rows.filter((r) => INVISIBLE.test(`${r.title}${r.company}${r.location ?? ""}`))
  const changing = rows.filter((r) => fingerprintOf(r) !== r.fingerprint)
  const otherMismatch = changing.filter((r) => !INVISIBLE.test(`${r.title}${r.company}${r.location ?? ""}`))
  const byNew = new Map<string, any[]>()
  for (const r of rows) { const k = fingerprintOf(r); byNew.set(k, [...(byNew.get(k) || []), r]) }
  const collisions = [...byNew.values()].filter((g) => g.length > 1)

  console.log(`postings: ${rows.length}`)
  console.log(`rows containing an invisible character: ${withInvisible.length}`)
  for (const r of withInvisible) console.log(`  [${r.source}] ${JSON.stringify(r.company)} | ${JSON.stringify(r.title)} | ${JSON.stringify(r.location)}`)
  console.log(`rows whose fingerprint changes under the new rule: ${changing.length}`)
  console.log(`  of which have NO invisible char (pre-existing mirror/SQL mismatch): ${otherMismatch.length}`)
  for (const r of otherMismatch.slice(0, 10)) console.log(`    [${r.source}] ${r.company} | ${r.title} | ${r.location}`)
  console.log(`collisions under the new rule: ${collisions.length}`)
  for (const g of collisions) console.log("  " + g.map((r) => `[${r.source}] ${r.company} | ${r.title} | ${r.location}`).join("  <>  "))
})().catch((e) => { console.error(e); process.exit(1) })
