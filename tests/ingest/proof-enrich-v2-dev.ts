/**
 * Dev proof for enrichment v2 (20261029_postings_enrichment_v2.sql and
 * lib/ingest/enrichPostings.ts). Run AFTER the migration is applied on dev.
 *
 *   ANTHROPIC_API_KEY=... NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/proof-enrich-v2-dev.ts \
 *     --opus20 <dev-opus20-before.json>
 *
 * --opus20 is the read-only snapshot of the 20 rows the 2026-09-19 Opus
 * extractor enriched, taken BEFORE the migration (id, first_seen_at,
 * last_seen_at). The migration clears them; this proves it did so without
 * moving their timestamps, then re-enriches them.
 *
 * Steps:
 *   1. worklist counts; timestamps of every row about to be enriched
 *   2. enrich every due SearchApi row, then the 20 Greenhouse rows
 *   3. no timestamp moved; every attempted row recorded the description it
 *      read; run rows match; field states as expected
 *   4. second run over the same scope takes nothing
 *   5. one row's description is edited: it becomes due ("changed"), is
 *      re-enriched, then the edit is undone and it is re-enriched once more
 *      (that row's last_seen_at moves twice: an edit to raw is an ingest-style
 *      write, which is the behaviour being proved)
 *
 * WRITES on dev only (refuses prod): postings enrichment columns, two
 * enrichment_runs rows per run step, and the step-5 edit and undo. About 240
 * Haiku calls, roughly $0.30.
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { countWorklist, runEnrichment, type EnrichSummary } from "../../lib/ingest/enrichPostings"

const PROD_REF = "ejhnokcnahauvrcbcmic"
const ENV_FILE = join(__dirname, "..", "..", ".env.phase0")
const fileEnv: Record<string, string> = {}
if (existsSync(ENV_FILE)) for (const l of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && m[2].trim()) fileEnv[m[1]] = m[2].trim() }
const env = (k: string) => process.env[k] || fileEnv[k]
const URL_ = env("SUPABASE_URL")!, KEY = env("SUPABASE_SERVICE_ROLE_KEY")!
const ref = new URL(URL_).hostname.split(".")[0]
if (ref === PROD_REF) { console.error("Refusing to run against prod."); process.exit(1) }
if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY must be set"); process.exit(1) }
const oi = process.argv.indexOf("--opus20")
if (oi < 0) { console.error("--opus20 <snapshot.json> is required"); process.exit(1) }
const opus20: { id: string; first_seen_at: string; last_seen_at: string }[] = JSON.parse(readFileSync(process.argv[oi + 1], "utf8"))
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

let failures = 0
const check = (label: string, cond: boolean, detail = "") => {
  if (!cond) failures++
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`)
}
const line = (s: EnrichSummary) =>
  `run ${s.runId}: attempted ${s.attempted}, enriched ${s.succeeded}, too short ${s.skippedShort}, failed ${s.failed}, demoted ${s.demoted}, $${s.costUsd.toFixed(4)}`
const COLS = "id, source, first_seen_at, last_seen_at, last_seen_elsewhere_at, description_md5, enrichment_description_md5, enriched_at, enrichment_failed_at, enrichment_run_id, years_min, years_max, years_basis, salary_low, salary_period, graduation_text, graduation_from, deadline_text, application_deadline, \"function\", industry, enrichment_not_stated, cleaned_title"

async function rowsFor(ids: string[]) {
  const out: any[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from("postings").select(COLS).in("id", ids.slice(i, i + 200))
    if (error) throw error
    out.push(...data!)
  }
  return new Map(out.map((r) => [r.id, r]))
}

;(async () => {
  console.log(`Project ${ref} (dev)\n`)
  console.log("1. Before")
  const before = await countWorklist(sb)
  console.log("  worklist", JSON.stringify(before))
  const dueSearch: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("postings_enrichment_due").select("id").eq("source", "searchapi").range(from, from + 999)
    if (error) throw error
    dueSearch.push(...data!.map((r) => r.id)); if (data!.length < 1000) break
  }
  const ids20 = opus20.map((r) => r.id)
  const snap = await rowsFor([...dueSearch, ...ids20])
  console.log(`  due SearchApi rows ${dueSearch.length}; Opus rows ${ids20.length}`)

  const opusNow = await rowsFor(ids20)
  check("migration cleared the 20 Opus rows", ids20.every((id) => !opusNow.get(id)?.enriched_at))
  check("and did not move their timestamps", opus20.every((o) => {
    const r = opusNow.get(o.id); return r && Date.parse(r.last_seen_at) === Date.parse(o.last_seen_at) && Date.parse(r.first_seen_at) === Date.parse(o.first_seen_at)
  }))

  console.log("\n2. Enrich")
  const a = await runEnrichment(sb, { sources: ["searchapi"], limit: 2000, triggeredBy: "proof:enrich-v2-dev:searchapi" })
  console.log("  " + line(a))
  const b = await runEnrichment(sb, { ids: ids20, limit: 100, triggeredBy: "proof:enrich-v2-dev:opus20" })
  console.log("  " + line(b))
  for (const r of [...a.rows, ...b.rows]) if (r.status === "failed") console.log(`    failed ${r.company} | ${r.title}: ${r.error?.slice(0, 160)}`)

  console.log("\n3. After")
  const attempted = [...a.rows, ...b.rows].map((r) => r.id)
  const after = await rowsFor(attempted)
  const failedRows = [...a.rows, ...b.rows].filter((r) => r.status === "failed")
  check("no posting failed", failedRows.length === 0, failedRows.length ? `${failedRows.length} failed` : "")
  check("every due row was attempted", a.attempted === dueSearch.length && b.attempted === ids20.length, `${a.attempted}/${dueSearch.length}, ${b.attempted}/${ids20.length}`)
  check("last_seen_at, first_seen_at, last_seen_elsewhere_at unchanged on all", attempted.every((id) => {
    const x = snap.get(id), y = after.get(id)
    return x && y && x.last_seen_at === y.last_seen_at && x.first_seen_at === y.first_seen_at && x.last_seen_elsewhere_at === y.last_seen_elsewhere_at
  }))
  check("every attempted row recorded the description it read", attempted.every((id) => after.get(id)?.enrichment_description_md5 === after.get(id)?.description_md5))
  check("enriched rows point at their run", [...a.rows, ...b.rows].filter((r) => r.status === "enriched").every((r) => after.get(r.id)?.enrichment_run_id === (a.rows.includes(r) ? a.runId : b.runId)))
  const { data: runs } = await sb.from("enrichment_runs").select("id, status, attempted, succeeded, failed, skipped_short, demoted, cost_usd, model, prompt_sha256").in("id", [a.runId, b.runId])
  check("enrichment_runs rows match the summaries", [a, b].every((s) => {
    const r = runs!.find((x) => x.id === s.runId)
    return r && r.status === "ok" && r.attempted === s.attempted && r.succeeded === s.succeeded && r.failed === s.failed && r.skipped_short === s.skippedShort && r.model === "claude-haiku-5-5"
  }))
  const enr = [...after.values()].filter((r) => r.enriched_at)
  const stat = (f: (r: any) => boolean) => enr.filter(f).length
  console.log(`  enriched ${enr.length}: years stated ${stat((r) => r.years_basis !== null)} (zero minimum ${stat((r) => r.years_min === 0)}, open-ended ${stat((r) => r.years_min !== null && r.years_max === null)}, preferred ${stat((r) => r.years_basis === "preferred")}), not stated ${stat((r) => r.enrichment_not_stated.includes("years"))}`)
  console.log(`    salary ${stat((r) => r.salary_low !== null)} (hourly ${stat((r) => r.salary_period === "hour")}), graduation ${stat((r) => r.graduation_text !== null)} (absolute ${stat((r) => r.graduation_from !== null)}), deadline ${stat((r) => r.deadline_text !== null)} (with date ${stat((r) => r.application_deadline !== null)}), function ${stat((r) => r.function !== null)}, industry ${stat((r) => r.industry !== null)}`)
  check("every enriched row has a cleaned title", enr.every((r) => r.cleaned_title))

  console.log("\n4. Second run over the same scope")
  const a2 = await runEnrichment(sb, { sources: ["searchapi"], limit: 2000, triggeredBy: "proof:enrich-v2-dev:rerun" })
  const b2 = await runEnrichment(sb, { ids: ids20, limit: 100, triggeredBy: "proof:enrich-v2-dev:rerun" })
  check("nothing due, nothing attempted", a2.attempted === 0 && b2.attempted === 0, `${a2.attempted}, ${b2.attempted}`)

  console.log("\n5. Changed description")
  const target = a.rows.find((r) => r.status === "enriched")!
  const { data: t0 } = await sb.from("postings").select("raw, last_seen_at, enrichment_run_id").eq("id", target.id).single()
  const edited = { ...t0!.raw, description: t0!.raw.description + "\n\nEdited for the enrichment v2 proof." }
  await sb.from("postings").update({ raw: edited }).eq("id", target.id)
  const { data: due1 } = await sb.from("postings_enrichment_due").select("reason").eq("id", target.id)
  check("edited row is due, reason changed", due1?.[0]?.reason === "changed")
  const c = await runEnrichment(sb, { ids: [target.id], triggeredBy: "proof:enrich-v2-dev:changed" })
  const { data: t1 } = await sb.from("postings").select("enrichment_run_id, enrichment_description_md5, description_md5, last_seen_at").eq("id", target.id).single()
  check("re-enriched by a new run and no longer due", c.succeeded === 1 && t1!.enrichment_run_id === c.runId && t1!.enrichment_description_md5 === t1!.description_md5)
  check("the edit (an ingest-style write) moved last_seen_at; the re-enrichment did not", Date.parse(t1!.last_seen_at) > Date.parse(t0!.last_seen_at))
  await sb.from("postings").update({ raw: t0!.raw }).eq("id", target.id)
  const d = await runEnrichment(sb, { ids: [target.id], triggeredBy: "proof:enrich-v2-dev:undo" })
  const { count: still } = await sb.from("postings_enrichment_due").select("id", { count: "exact", head: true }).eq("id", target.id)
  check("edit undone, re-enriched, not due", d.succeeded === 1 && still === 0)

  console.log("\nAfter:", JSON.stringify(await countWorklist(sb)))
  const cost = [a, b, c, d].reduce((n, s) => n + s.costUsd, 0)
  const n = [a, b, c, d].reduce((k, s) => k + s.attempted - s.skippedShort, 0)
  console.log(`Haiku calls ${n}, cost $${cost.toFixed(4)} ($${(cost / Math.max(n, 1)).toFixed(5)} per posting)`)
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nALL CHECKS PASSED")
  if (failures) process.exit(1)
})().catch((e) => { console.error(e); process.exit(1) })
