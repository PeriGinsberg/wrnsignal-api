// Run: npx tsx lib/ingest/staleness.test.ts
//
// The daily staleness check (lib/ingest/staleness.ts): ingest silence, plus
// enrichment / matching runs stuck 'running' past 2 hours. Offline: a fake
// Supabase client, and dryRun so nothing is sent.

import { checkStaleness, findStuckRuns, STUCK_RUN_HOURS } from "./staleness"
import { stalenessBody, stalenessSubject } from "../email/sendIngestAlert"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const NOW = new Date("2026-10-26T09:00:00Z")
type Tables = Record<string, { rows?: any[]; error?: { code?: string; message: string } }>

/** Enough of supabase-js for these queries: select / eq / lt / order / limit, awaited. */
function fakeSb(tables: Tables) {
  return {
    from(name: string) {
      const t = tables[name] ?? { rows: [] }
      let rows = [...(t.rows ?? [])]
      let head = false
      const q: any = {
        select(_cols: string, opts?: { head?: boolean }) { head = !!opts?.head; return q },
        eq(col: string, v: unknown) { rows = rows.filter((r) => r[col] === v); return q },
        lt(col: string, v: string) { rows = rows.filter((r) => r[col] < v); return q },
        order() { return q },
        limit(n: number) { rows = rows.slice(0, n); return q },
        then(res: (v: any) => void) {
          if (t.error) return res({ data: null, error: t.error, count: null })
          return res(head ? { data: null, error: null, count: rows.length } : { data: rows, error: null, count: rows.length })
        },
      }
      return q
    },
  } as any
}

const freshIngest = { rows: [{ created_at: "2026-10-26T04:35:00Z", source: "smartrecruiters", org_slug: "x", pair_title: "analyst", status: "ok" }] }

;(async () => {
  // A batch that stalled at 21:28 and never finished, one that finished, and a recent one still running.
  const tables: Tables = {
    ingest_runs: freshIngest,
    enrichment_runs: { rows: [
      { id: "stuck-1", status: "running", started_at: "2026-10-25T21:28:58Z", triggered_by: "manual:run-enrich" },
      { id: "done-1", status: "ok", started_at: "2026-10-25T21:04:15Z", triggered_by: "manual:run-enrich" },
      { id: "fresh-1", status: "running", started_at: "2026-10-26T08:30:00Z", triggered_by: "manual:run-enrich" },
    ] },
    postings: { rows: Array.from({ length: 889 }, () => ({ enrichment_run_id: "stuck-1" })) },
    match_runs: { rows: [] },
    posting_matches: { rows: [] },
  }
  const { stuck, errors } = await findStuckRuns(fakeSb(tables), NOW)
  ok("a run 'running' for 11.5h is stuck", stuck.length === 1 && stuck[0].id === "stuck-1" && stuck[0].table === "enrichment_runs")
  ok("rows it wrote are counted", stuck[0]?.written === 889)
  ok("a finished run and a run 30 minutes old are not stuck", !stuck.some((s) => s.id === "done-1" || s.id === "fresh-1"))
  ok("no errors", errors.length === 0)

  const res = await checkStaleness(fakeSb(tables), { now: NOW, dryRun: true, environment: "production" })
  ok("ingest fresh but a run stuck: alert anyway", !res.stale && !!res.alert && res.stuckRuns.length === 1)
  ok("subject names the stuck run", stalenessSubject(res.alert!) === "[SIGNAL] 1 enrichment/matching run stuck")
  const body = stalenessBody(res.alert!)
  ok("body lists the run, its start, its age and what it wrote", body.includes("enrichment_runs stuck-1") && body.includes("2026-10-25T21:28:58Z") && body.includes("11.5h ago") && body.includes("wrote 889 row(s)"))
  ok("body says ingest itself is fine", body.includes("Ingest itself is fine"))

  const quiet = await checkStaleness(fakeSb({ ingest_runs: freshIngest, enrichment_runs: { rows: [] }, match_runs: { rows: [] } }), { now: NOW, dryRun: true })
  ok("nothing stale, nothing stuck: no alert", quiet.alert === null)

  const missing = await checkStaleness(fakeSb({ ingest_runs: freshIngest, enrichment_runs: { error: { code: "PGRST205", message: "relation not found" } }, match_runs: { error: { code: "PGRST205", message: "relation not found" } } }), { now: NOW, dryRun: true })
  ok("run tables absent in this environment: no alert", missing.alert === null && missing.checkErrors.length === 0)

  const broken = await checkStaleness(fakeSb({ ingest_runs: freshIngest, enrichment_runs: { error: { code: "42501", message: "permission denied" } }, match_runs: { rows: [] } }), { now: NOW, dryRun: true, environment: "production" })
  ok("an unreadable run table alerts, never reads as 'none stuck'", !!broken.alert && broken.checkErrors[0] === "enrichment_runs: permission denied" && stalenessSubject(broken.alert!) === "[SIGNAL] run check failed")

  const silent = await checkStaleness(fakeSb({ ...tables, ingest_runs: { rows: [{ ...freshIngest.rows![0], created_at: "2026-10-24T03:00:00Z" }] } }), { now: NOW, dryRun: true, environment: "production" })
  ok("stale AND stuck: both in the subject", silent.stale && stalenessSubject(silent.alert!) === "[SIGNAL] ingest silent for 54h; 1 enrichment/matching run stuck")
  ok("stale body keeps its ingest text and adds the stuck section", stalenessBody(silent.alert!).includes("No ingest_runs row has been written for 54 hours") && stalenessBody(silent.alert!).includes("STUCK RUNS"))

  ok("threshold is 2 hours", STUCK_RUN_HOURS === 2)

  console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
  if (failures) process.exit(1)
})().catch((e) => { console.error(e); process.exit(1) })
