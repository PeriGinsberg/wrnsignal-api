/**
 * Read-only: prod rollout step 7. Did each nightly sweep since --since finish,
 * and do the verify checks hold?
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx tests/job-sourcing/probe-step7.ts --since 2026-10-25T14:55:00Z
 *
 * Shell env first, else .env.phase0. Selects only.
 */
import { readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
const env: Record<string, string> = {}
for (const l of readFileSync(join(__dirname, "..", "..", ".env.phase0"), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) if (process.env[k]) env[k] = process.env[k]!
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const i = process.argv.indexOf("--since"); const since = process.argv[i + 1]

async function all(table: string, cols: string, f: (q: any) => any) {
  const out: any[] = []
  for (let o = 0; ; o += 1000) {
    const { data, error } = await f(sb.from(table).select(cols)).range(o, o + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data || [])); if (!data || data.length < 1000) break
  }
  return out
}

;(async () => {
  console.log(`project ${new URL(env.SUPABASE_URL).hostname.split(".")[0]}; since ${since}\n`)

  // Expected board-runs: active pairs that each source runs x that source's active boards.
  const pairs = await all("ingest_pairs", "id,title,sources", (q) => q.eq("active", true))
  const boards = await all("ingest_boards", "source,org_slug", (q) => q.eq("active", true))
  const runs = await all("ingest_runs", "source,org_slug,pair_id,pair_title,status,control_passed,found_count,added_count,refound_count,intra_run_duplicate_count,error,created_at,finished_at",
    (q) => q.gte("created_at", since).order("created_at"))

  for (const source of ["grnhse", "smartrecruiters"]) {
    const ps = pairs.filter((p) => p.sources === null || p.sources.includes(source))
    const bs = boards.filter((b) => b.source === source)
    const rs = runs.filter((r) => r.source === source)
    const byStatus: Record<string, number> = {}; for (const r of rs) byStatus[r.status] = (byStatus[r.status] || 0) + 1
    const sum = (k: string) => rs.reduce((n, r) => n + (r[k] || 0), 0)
    const covered = new Set(rs.map((r) => r.pair_id + "|" + r.org_slug))
    const missing = ps.flatMap((p) => bs.filter((b) => !covered.has(p.id + "|" + b.org_slug)).map((b) => `${p.title} @ ${b.org_slug}`))
    console.log(`${source}: expected ${ps.length} pairs x ${bs.length} boards = ${ps.length * bs.length} board-runs; got ${rs.length} ${JSON.stringify(byStatus)}`)
    console.log(`  first ${rs[0]?.created_at ?? "-"}  last ${rs[rs.length - 1]?.finished_at ?? "-"}`)
    console.log(`  found ${sum("found_count")}, added ${sum("added_count")}, refound ${sum("refound_count")}, intra-run dup ${sum("intra_run_duplicate_count")}`)
    console.log(`  missing board-runs: ${missing.length}${missing.length ? " e.g. " + missing.slice(0, 5).join("; ") : ""}`)
    const bad = rs.filter((r) => r.status === "error" || r.control_passed === false)
    console.log(`  error or control-failed rows: ${bad.length}`)
    for (const r of bad.slice(0, 10)) console.log(`    ${r.status} ctrl=${r.control_passed} ${r.org_slug} "${r.pair_title}" ${r.error ?? ""}`)
    // added == found on a board that had postings before today means the
    // added/refound test is not working.
    const suspect = rs.filter((r) => r.status === "ok" && r.found_count > 0 && r.added_count === r.found_count)
    console.log(`  ok rows with found > 0 and added == found: ${suspect.length}`)
    for (const r of suspect.slice(0, 8)) console.log(`    ${r.org_slug} "${r.pair_title}" found=${r.found_count} added=${r.added_count}`)
  }

  const services = runs.filter((r) => !["grnhse", "smartrecruiters"].includes(r.source))
  console.log(`\nother-source ingest_runs since: ${services.length}`)

  const { data: lr, error: le } = await sb.from("posting_link_runs")
    .select("triggered_by,mode,status,postings_scanned,proposed_count,ambiguous_count,near_miss_count,written_count,removed_count,error,started_at,duration_ms")
    .gte("started_at", since).order("started_at")
  if (le) throw le
  console.log(`\nposting_link_runs since: ${(lr || []).length}`)
  for (const r of lr || []) console.log(`  ${r.started_at} ${r.triggered_by} mode=${r.mode} status=${r.status} scanned=${r.postings_scanned} proposed=${r.proposed_count} ambiguous=${r.ambiguous_count} near=${r.near_miss_count} written=${r.written_count} removed=${r.removed_count} ${r.duration_ms}ms${r.error ? " ERROR " + r.error : ""}`)

  const { count: links } = await sb.from("posting_links").select("secondary_id", { count: "exact", head: true })
  const { count: p } = await sb.from("postings").select("id", { count: "exact", head: true })
  const { count: c } = await sb.from("postings_canonical").select("id", { count: "exact", head: true })
  const { count: elsewhere } = await sb.from("postings").select("id", { count: "exact", head: true }).not("last_seen_elsewhere_at", "is", null)
  console.log(`\nposting_links ${links}; postings ${p}; postings_canonical ${c}; rows with last_seen_elsewhere_at ${elsewhere}`)
})().catch((e) => { console.error(e); process.exit(1) })
