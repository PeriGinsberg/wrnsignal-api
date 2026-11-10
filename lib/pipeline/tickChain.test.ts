// Run: npx tsx lib/pipeline/tickChain.test.ts
//
// runTick against an in-memory pipeline_runs: matching that finishes early
// runs the queue release in the same tick; a failed release emails that it
// will be retried, and the next tick retries it.

import { runTick } from "./tick"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

type Row = Record<string, any>
function fakeSb(rows: Row[], release: () => { data: any; error: any }) {
  let n = 0
  const exec = (s: { table: string; op: string; filters: Record<string, any>; payload: any }) => {
    if (s.table !== "pipeline_runs") return { data: [], error: null, count: 0 }
    if (s.op === "insert") {
      const r = { id: `r${n++}`, status: "running", started_at: new Date().toISOString(), finished_at: null, units: 0, cost_usd: 0, searches: 0, detail: {}, error: null, ...s.payload }
      rows.push(r)
      return { data: { id: r.id }, error: null }
    }
    const hit = rows.filter((r) => Object.entries(s.filters).every(([k, v]) => r[k] === v))
    if (s.op === "update") { hit.forEach((r) => Object.assign(r, s.payload)); return { error: null } }
    return { data: hit, error: null }
  }
  const from = (table: string) => {
    const s = { table, op: "select", filters: {} as Record<string, any>, payload: null as any }
    const b: any = {
      select: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lt: () => b, in: () => b, single: () => b,
      eq: (k: string, v: any) => { s.filters[k] = v; return b },
      insert: (p: any) => { s.op = "insert"; s.payload = p; return b },
      update: (p: any) => { s.op = "update"; s.payload = p; return b },
      then: (res: any, rej: any) => Promise.resolve(exec(s)).then(res, rej),
    }
    return b
  }
  return { from, rpc: async (name: string) => (name === "release_queue" ? release() : { data: null, error: { message: "no rpc " + name } }) } as any
}

const NIGHT = "2026-10-30"
const base = (): Row[] => ["google_jobs", "enrich"].map((step, i) => ({ id: `b${i}`, night: NIGHT, step, status: "ok", started_at: `${NIGHT}T05:0${i}:00Z`, finished_at: `${NIGHT}T05:0${i}:30Z`, units: 0, cost_usd: 0, searches: 0, detail: {}, error: null }))

;(async () => {
  {
    const rows = base()
    const mails: string[] = []
    const sb = fakeSb(rows, () => ({ data: { released: { a: { released: 8, deadline: 0 } }, expired: {}, below_floor: {} }, error: null }))
    const r = await runTick(sb, { environment: "test", send: async (s) => { mails.push(s) }, now: new Date(`${NIGHT}T06:00:00Z`) })
    ok("matching finished early: the release ran in the same tick", r.ran?.step === "match" && r.chained?.step === "queue_release" && r.chained.result.status === "ok")
    ok("both recorded for the night", rows.filter((x) => x.step === "match" && x.status === "ok").length === 1 && rows.filter((x) => x.step === "queue_release" && x.status === "ok").length === 1)
    ok("no failure email", !mails.some((m) => m.includes("failed")))
  }
  {
    const rows = base()
    const mails: string[] = []
    let calls = 0
    const sb = fakeSb(rows, () => (++calls === 1
      ? { data: null, error: { message: "canceling statement due to statement timeout" } }
      : { data: { released: {}, expired: {}, below_floor: {} }, error: null }))
    const send = async (s: string) => { mails.push(s) }
    const r1 = await runTick(sb, { environment: "test", send, now: new Date(`${NIGHT}T06:00:00Z`) })
    ok("a release that fails in the chained run is recorded as an error", r1.chained?.result.status === "error")
    ok("its email says it will be retried", mails.some((m) => m.includes("queue_release failed, retrying")))
    const r2 = await runTick(sb, { environment: "test", send, now: new Date(`${NIGHT}T06:15:00Z`) })
    ok("the next tick retries the release, and it succeeds", r2.ran?.step === "queue_release" && r2.ran.retry === 1 && r2.ran.result.status === "ok")
    const r3 = await runTick(sb, { environment: "test", send, now: new Date(`${NIGHT}T06:30:00Z`) })
    ok("then the link check", r3.ran?.step === "link_check")
  }
  console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
  if (failures) process.exit(1)
})()
