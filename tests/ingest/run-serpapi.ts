/**
 * Phase 1 run: SerpApi (Google Jobs) over the ingest_pairs scoped to serpapi.
 * No cron; this is the only way the source runs.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/run-serpapi.ts --dry
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/run-serpapi.ts
 *
 * Flags:
 *   --dry               list the pairs and the searches it would spend; no calls
 *   --title "..."       only pairs with this title (exact, case-insensitive)
 *   --location "..."    only pairs with this location
 *   --max-pages N       pages per pair (default 3)
 *   --prod              required to write to the prod project
 *
 * Creds: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SERPAPI_KEY from the shell,
 * else from .env.phase0 at the repo root.
 *
 * WRITES: postings and ingest_runs. Costs one SerpApi search per page fetched
 * plus one control search per distinct location.
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { serpApiAdapter, queryFor, GOOGLE_JOBS } from "../../lib/ingest/serpapi"
import { runSweep } from "../../lib/ingest/runner"
import type { IngestPair } from "../../lib/ingest/types"

const PROD_REF = "ejhnokcnahauvrcbcmic"

const ENV_FILE = join(__dirname, "..", "..", ".env.phase0")
const fileEnv: Record<string, string> = {}
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && m[2]) fileEnv[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2")
  }
}
const env = (k: string) => process.env[k] || fileEnv[k]

const arg = (name: string) => {
  const i = process.argv.indexOf("--" + name)
  const next = process.argv[i + 1]
  return i >= 0 && next && !next.startsWith("--") ? next : undefined
}
const flag = (name: string) => process.argv.includes("--" + name)

const URL_ = env("SUPABASE_URL")
const KEY = env("SUPABASE_SERVICE_ROLE_KEY")
const SERPAPI_KEY = env("SERPAPI_KEY")
const DRY = flag("dry")
if (!URL_ || !KEY) { console.error(`SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required (shell or ${ENV_FILE})`); process.exit(1) }
if (!SERPAPI_KEY && !DRY) { console.error(`SERPAPI_KEY required (shell or ${ENV_FILE})`); process.exit(1) }

const ref = new URL(URL_).hostname.split(".")[0]
if (ref === PROD_REF && !DRY && !flag("prod")) {
  console.error(`Refusing to write to prod (${ref}) without --prod.`)
  process.exit(1)
}

const sb = createClient(URL_, KEY, { auth: { persistSession: false } })
const maxPages = Number(arg("max-pages") ?? 3)

;(async () => {
  console.log(`Supabase project: ${ref}${ref === PROD_REF ? " (PROD)" : ""}${DRY ? "  [dry run]" : ""}`)

  const { data, error } = await sb
    .from("ingest_pairs")
    .select("id, title, location, campus")
    .eq("active", true)
    .contains("sources", ["serpapi"])
    .order("title")
  if (error) throw new Error(`could not load ingest_pairs: ${error.message}`)

  const t = arg("title")?.toLowerCase()
  const l = arg("location")?.toLowerCase()
  const pairs: IngestPair[] = (data || [])
    .filter((p: any) => (!t || p.title.toLowerCase() === t) && (!l || String(p.location ?? "").toLowerCase() === l))
    .map((p: any) => ({ id: p.id, title: p.title, location: p.location, campus: Boolean(p.campus) }))

  if (!pairs.length) { console.error("no active serpapi pairs match"); process.exit(1) }
  const locations = new Set(pairs.map((p) => p.location ?? "*no-location*"))
  console.log(`${pairs.length} pair(s), ${locations.size} location(s). Up to ${pairs.length * maxPages + locations.size} searches (${maxPages} page(s) per pair + 1 control per location).`)
  for (const p of pairs) console.log(`  q="${queryFor(p)}"${p.campus ? "  [campus]" : ""}`)
  if (DRY) return

  const adapter = serpApiAdapter({ apiKey: SERPAPI_KEY, maxPages })
  const swept = await runSweep(adapter, pairs, [GOOGLE_JOBS], sb)

  const tot = { found: 0, added: 0, refound: 0, dup: 0, req: 0, errors: 0 }
  console.log("")
  for (const { pair, outcomes } of swept) {
    for (const o of outcomes) {
      tot.found += o.foundCount; tot.added += o.addedCount; tot.refound += o.refoundCount
      tot.dup += o.intraRunDuplicateCount; tot.req += o.requestsMade; if (o.status === "error") tot.errors++
      console.log(
        `  ${o.status.padEnd(7)} ctrl=${String(o.controlPassed).padEnd(5)} found=${String(o.foundCount).padStart(3)} ` +
          `added=${String(o.addedCount).padStart(3)} refound=${String(o.refoundCount).padStart(3)} dup=${String(o.intraRunDuplicateCount).padStart(2)} ` +
          `req=${o.requestsMade}  ${pair.title} | ${pair.location ?? "-"}${o.error ? "  ERROR " + o.error.slice(0, 160) : ""}`
      )
    }
  }
  console.log(`\nTotals: found ${tot.found}, added ${tot.added}, refound ${tot.refound}, intra-run duplicates ${tot.dup}, searches ${tot.req}, errors ${tot.errors}`)
})().catch((e) => { console.error(e); process.exit(1) })
