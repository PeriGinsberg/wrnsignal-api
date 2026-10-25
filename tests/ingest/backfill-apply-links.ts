/**
 * Re-choose the apply link for stored Google Jobs postings (serpapi, searchapi)
 * with lib/ingest/applyLinks.ts, and set apply_link_kind. New ingests do this
 * themselves; this is the one-off for rows stored before 20261103.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/backfill-apply-links.ts [--dry] [--prod]
 *
 * Every row gets apply_link_checked_at, which postings_touch_last_seen treats
 * as a re-read: last_seen_at does not move. Prints how many links changed and
 * how many postings are republished-only.
 *
 * Creds: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the shell, else
 * .env.phase0. Writing to prod needs --prod.
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { chooseApplyLink, linksFromRaw } from "../../lib/ingest/applyLinks"

const PROD_REF = "ejhnokcnahauvrcbcmic"
const ENV_FILE = join(__dirname, "..", "..", ".env.phase0")
const fileEnv: Record<string, string> = {}
if (existsSync(ENV_FILE)) for (const l of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && m[2]) fileEnv[m[1]] = m[2] }
const env = (k: string) => process.env[k] || fileEnv[k]
const flag = (n: string) => process.argv.includes("--" + n)
const URL_ = env("SUPABASE_URL")!, KEY = env("SUPABASE_SERVICE_ROLE_KEY")!
const ref = new URL(URL_).hostname.split(".")[0]
const DRY = flag("dry")
if (ref === PROD_REF && !DRY && !flag("prod")) { console.error(`Refusing to write to prod (${ref}) without --prod.`); process.exit(1) }
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

;(async () => {
  const rows: any[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from("postings").select("id, source, company, apply_url, raw").in("source", ["serpapi", "searchapi"]).order("id").range(from, from + 499)
    if (error) throw error
    rows.push(...data!); if (data!.length < 500) break
  }
  const now = new Date().toISOString()
  const kinds: Record<string, number> = {}
  let changed = 0, failed = 0
  for (const r of rows) {
    const share = r.raw?.sharing_link ?? r.raw?.share_link ?? null
    const link = chooseApplyLink(r.company, linksFromRaw(r.raw), share)
    kinds[link?.kind ?? "none"] = (kinds[link?.kind ?? "none"] ?? 0) + 1
    if ((link?.url ?? null) !== r.apply_url) changed++
    if (DRY) continue
    const { error } = await sb.from("postings").update({ apply_url: link?.url ?? r.apply_url, apply_link_kind: link?.kind ?? null, apply_link_checked_at: now }).eq("id", r.id)
    if (error) { failed++; console.log(`  ${r.id}: ${error.message}`) }
  }
  console.log(`Project ${ref}${DRY ? " [dry]" : ""}: ${rows.length} Google Jobs postings; apply link changed on ${changed}; kinds ${JSON.stringify(kinds)}; write failures ${failed}`)
})().catch((e) => { console.error(e); process.exit(1) })
