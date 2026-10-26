/**
 * Which timing mode each active client lands in, from their profile
 * (lib/match/criteria.ts availableFromProfile), and seed available_from onto
 * the clients that have match criteria (2026-10-26).
 *
 *   future_start   available_from after today: the queue's campus tier
 *   available_now  available_from today or earlier, or none
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/match/timing-modes.ts            report only
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/match/timing-modes.ts --prod     also write available_from
 *
 * Writes only client_match_criteria.available_from, only where it differs.
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { availableFromProfile } from "../../lib/match/criteria"

const PROD_REF = "ejhnokcnahauvrcbcmic"
const ENV_FILE = join(__dirname, "..", "..", ".env.phase0")
const fileEnv: Record<string, string> = {}
if (existsSync(ENV_FILE)) for (const l of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && m[2]) fileEnv[m[1]] = m[2] }
const env = (k: string) => process.env[k] || fileEnv[k]
const URL_ = env("SUPABASE_URL")!, KEY = env("SUPABASE_SERVICE_ROLE_KEY")!
const ref = new URL(URL_).hostname.split(".")[0]
const WRITE = process.argv.includes("--prod") || ref !== PROD_REF
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })
const today = new Date().toISOString().slice(0, 10)

;(async () => {
  const { data: profiles, error } = await sb.from("client_profiles")
    .select("id, name, email, timeline, grad_date, education_status")
    .eq("active", true).or("is_coach.is.null,is_coach.eq.false")
  if (error) throw error
  const { data: crit } = await sb.from("client_match_criteria").select("client_profile_id, active, available_from")
  const byId = new Map((crit ?? []).map((c) => [c.client_profile_id, c]))

  const rows = profiles!.map((p) => {
    const a = availableFromProfile(p, today)
    return { p, a, mode: a.date && a.date > today ? "future_start" : "available_now", c: byId.get(p.id) }
  })
  const label = (r: (typeof rows)[number]) => `${(r.p.name || "").trim() || String(r.p.email).trim()}${r.c ? (r.c.active ? "  [matching]" : "  [criteria, inactive]") : ""}`
  const why = (r: (typeof rows)[number]) =>
    r.a.source === "none" ? `timeline ${JSON.stringify(r.p.timeline)}` :
    r.a.source === "graduation" ? `in school, graduates ${r.p.grad_date}` :
    `timeline ${JSON.stringify(r.p.timeline)}`

  for (const mode of ["future_start", "available_now"]) {
    const g = rows.filter((r) => r.mode === mode && (r.p.timeline || r.p.grad_date || r.c))
    console.log(`\n${mode} (${g.length})`)
    for (const r of g.sort((x, y) => String(x.a.date ?? "").localeCompare(String(y.a.date ?? "")))) {
      console.log(`  ${label(r)}\tavailable_from ${r.a.date ?? "none"}\t(${why(r)})`)
    }
  }
  const blank = rows.filter((r) => !r.p.timeline && !r.p.grad_date && !r.c).length
  console.log(`\navailable_now with nothing on the profile (no timeline, no graduation date): ${blank}`)

  for (const r of rows.filter((r) => r.c && r.c.available_from !== r.a.date)) {
    console.log(`criteria ${label(r)}: available_from ${r.c!.available_from ?? "none"} -> ${r.a.date ?? "none"}${WRITE ? "" : "  (not written: add --prod)"}`)
    if (WRITE) {
      const { error: e } = await sb.from("client_match_criteria").update({ available_from: r.a.date }).eq("client_profile_id", r.p.id)
      if (e) throw e
    }
  }
})().catch((e) => { console.error(e); process.exit(1) })
