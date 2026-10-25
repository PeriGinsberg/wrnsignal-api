/**
 * Run the cross-source linker once and print its report.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/run-linker.ts
 *
 * Mode comes from INGEST_LINK_MODE (unset = report). In report mode it writes
 * only a posting_link_runs row. Write mode against prod needs --prod.
 * --preview: compute and print the proposal only; writes nothing at all (works
 * before 20261027_posting_links.sql is applied).
 *
 * Creds: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the shell, else
 * .env.phase0 at the repo root.
 */
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { runLinker, linkMode, loadLinkInputs, proposeLinks } from "../../lib/ingest/link"

const PROD_REF = "ejhnokcnahauvrcbcmic"
const env: Record<string, string> = {}
const ENV_FILE = join(__dirname, "..", "..", ".env.phase0")
if (existsSync(ENV_FILE)) for (const l of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && m[2].trim()) env[m[1]] = m[2].trim() }
const get = (k: string) => process.env[k] || env[k]
const URL_ = get("SUPABASE_URL"), KEY = get("SUPABASE_SERVICE_ROLE_KEY")
if (!URL_ || !KEY) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1) }
const ref = new URL(URL_).hostname.split(".")[0]
if (ref === PROD_REF && linkMode() === "write" && !process.argv.includes("--prod")) {
  console.error("Refusing write mode on prod without --prod."); process.exit(1)
}
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

;(async () => {
  const preview = process.argv.includes("--preview")
  let r: { mode: string; runId: string | null; scanned: number; written: number; removed: number; proposal: ReturnType<typeof proposeLinks> }
  if (preview) {
    const { rows, aliases } = await loadLinkInputs(sb)
    r = { mode: "preview (nothing logged)", runId: null, scanned: rows.length, written: 0, removed: 0, proposal: proposeLinks(rows, aliases) }
  } else {
    r = await runLinker(sb, { triggeredBy: "manual:run-linker" })
  }
  const p = r.proposal
  console.log(`Project ${ref}${ref === PROD_REF ? " (PROD)" : ""}  mode=${r.mode}  run=${r.runId}`)
  console.log(`postings scanned: ${r.scanned}`)
  const tiers: Record<string, number> = {}
  for (const l of p.links) tiers[l.tier] = (tiers[l.tier] || 0) + 1
  const pairs: Record<string, number> = {}
  for (const l of p.links) { const k = `${l.primary_source} <- ${l.secondary_source}`; pairs[k] = (pairs[k] || 0) + 1 }
  console.log(`proposed links: ${p.links.length}  by tier ${JSON.stringify(tiers)}  by source ${JSON.stringify(pairs)}`)
  console.log(`posting_links written: ${r.written}, removed: ${r.removed}`)
  for (const l of p.links) console.log(`  [${l.tier}]${l.matched_city ? " city=" + l.matched_city : ""}${l.candidates > 1 ? ` (${l.candidates} candidates)` : ""}\n    P ${l.primary}\n    S ${l.secondary}`)
  console.log(`\nambiguous (more than one possible primary): ${p.ambiguous.length}`)
  for (const l of p.ambiguous) console.log(`  ${l.secondary}  (${l.candidates} candidates)`)
  console.log(`\nnear misses (same employer + title, other source, no shared city): ${p.nearMisses.length}`)
  for (const m of p.nearMisses) console.log(`    ${m.a}\n    ${m.b}`)
  console.log(`\nalias suggestions (not applied): ${p.aliasSuggestions.length}`)
  for (const a of p.aliasSuggestions) console.log(`  "${a.alias}" [${a.alias_sources.join(",")}] -> "${a.canonical}" [${a.canonical_sources.join(",")}]${a.would_add ? `  +${a.would_add} link(s)` : ""}`)
})().catch((e) => { console.error(e); process.exit(1) })
