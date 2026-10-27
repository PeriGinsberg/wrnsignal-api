/**
 * Enrichment v2 writer from the command line (lib/ingest/enrichPostings.ts).
 * No cron yet. Prod has the schema since 20261031_postings_enrichment_prod.sql
 * (applied 2026-10-25); writing there needs --prod.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/run-enrich.ts --count
 *   ANTHROPIC_API_KEY=... NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/run-enrich.ts --limit 50
 *
 * Flags:
 *   --count               print the worklist counts and stop
 *   --limit N             postings this run takes (default 500)
 *   --sources a,b         only these sources
 *   --ids file.json       only these posting ids (still only if due)
 *   --reenrich-before ts  also re-enrich postings enriched before ts, plus any
 *                         never enriched (one-off pass after new fields)
 *   --retry-failed        take postings whose last attempt failed (description
 *                         unchanged) instead of the due worklist
 *   --dry                 extract but write nothing (still costs API calls)
 *   --prod                required to write to the prod project
 *
 * Creds: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the shell, else
 * .env.phase0; ANTHROPIC_API_KEY from the shell.
 *
 * WRITES: postings enrichment columns and one enrichment_runs row.
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { countWorklist, runEnrichment } from "../../lib/ingest/enrichPostings"

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

const URL_ = env("SUPABASE_URL"), KEY = env("SUPABASE_SERVICE_ROLE_KEY")
if (!URL_ || !KEY) { console.error(`SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required (shell or ${ENV_FILE})`); process.exit(1) }
const ref = new URL(URL_).hostname.split(".")[0]
if (ref === PROD_REF && !flag("prod") && !flag("count")) { console.error(`Refusing to write to prod (${ref}) without --prod.`); process.exit(1) }
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

;(async () => {
  console.log(`Supabase project: ${ref}${ref === PROD_REF ? " (PROD)" : ""}`)
  console.log("Worklist:", JSON.stringify(await countWorklist(sb)))
  if (flag("count")) return
  if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY must be set"); process.exit(1) }

  const ids = arg("ids") ? (JSON.parse(readFileSync(arg("ids")!, "utf8")) as string[]) : undefined
  const s = await runEnrichment(sb, {
    limit: Number(arg("limit") ?? 500),
    sources: arg("sources")?.split(","),
    ids,
    dryRun: flag("dry"),
    retryFailed: flag("retry-failed"),
    reenrichBefore: arg("reenrich-before"),
    triggeredBy: flag("retry-failed") ? "manual:run-enrich:retry-failed" : "manual:run-enrich",
  })
  console.log(
    `Run ${s.runId ?? "(dry)"}: attempted ${s.attempted}, enriched ${s.succeeded}, too short ${s.skippedShort}, failed ${s.failed}, ` +
      `demoted ${s.demoted}, ${s.apiCalls} API calls, $${s.costUsd.toFixed(4)}` + (s.attempted ? ` ($${(s.costUsd / s.attempted).toFixed(5)} per posting)` : ""),
  )
  for (const r of s.rows) for (const d of r.demoted) console.log(`  demoted ${d.field}="${d.value}" (${d.why}): ${r.company} | ${r.title}`)
  for (const r of s.rows) if (r.status === "failed") console.log(`  failed ${r.source} ${r.company} | ${r.title}: ${r.error?.slice(0, 200)}`)
  console.log("Worklist:", JSON.stringify(await countWorklist(sb)))
})().catch((e) => { console.error(e); process.exit(1) })
