// Run: npx tsx lib/ingest/searchCap.test.ts
//
// Two cost guards on paid Google Jobs runs, offline. The real SearchApi adapter
// and the real runner, with fetch and Supabase stubbed:
//   1. a control that throws is recorded once per city and reused for every
//      other pair there, never retried per pair (lib/ingest/runner.ts);
//   2. the per-run search cap (lib/ingest/searchCap.ts) is never exceeded,
//      stops the run when it bites, and sends the ingest alert
//      (runGoogleJobs in lib/ingest/googleJobs.ts).
// Takes ~15s: the runner's 500ms spacing between requests is real.

import { runSweep } from "./runner"
import { searchApiAdapter } from "./searchapi"
import { runGoogleJobs } from "./googleJobs"
import { GOOGLE_JOBS, NONSENSE } from "./serpapi"
import { DEFAULT_SEARCH_CAP, SearchBudget, SearchCapReached, searchCapFromEnv } from "./searchCap"
import { alertBody, alertSubject, type IngestAlert } from "../email/sendIngestAlert"
import type { ControlResult, IngestPair, SourceAdapter } from "./types"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

// ── Stubs ─────────────────────────────────────────────────────────────────
function fakeSb() {
  const runs: any[] = []
  const seen = new Set<string>()
  const sb: any = {
    from: () => ({
      insert: (row: any) => { runs.push(row); return { select: async () => ({ data: [{ id: "run" + runs.length }], error: null }) } },
      upsert: (rows: any[]) => ({
        select: async () => ({
          data: rows.map((r) => {
            const fp = `${r.title}|${r.company}|${r.location}`
            const t = new Date().toISOString()
            const old = seen.has(fp)
            seen.add(fp)
            return { fingerprint: fp, created_at: old ? "2026-01-01T00:00:00Z" : t, updated_at: t }
          }),
          error: null,
        }),
      }),
    }),
  }
  return { sb, runs }
}

/** SearchApi over HTTP: every call is counted; `controlError` makes the nonsense-term control fail. */
let calls: string[] = []
let controlError: string | null = null
;(globalThis as any).fetch = async (url: string) => {
  const u = new URL(url)
  const q = u.searchParams.get("q") ?? ""
  calls.push(q + (u.searchParams.get("next_page_token") ? " #" + u.searchParams.get("next_page_token") : ""))
  const body = q.startsWith(NONSENSE)
    ? controlError ? { error: controlError } : { error: "Google Jobs didn't return any results." }
    : {
        jobs: [{ title: `Analyst ${calls.length}`, company_name: "Acme", location: "Chicago, IL", description: "x", apply_link: "https://acme.com/1" }],
        pagination: { next_page_token: "p" + calls.length },
      }
  return new Response(JSON.stringify(body), { status: 200 })
}

const pair = (title: string, location: string): IngestPair => ({ id: title + location, title, location, campus: false })
const chicago = ["analyst", "associate", "banker"].map((t) => pair(t, "Chicago, IL"))
const columbus = ["analyst", "associate"].map((t) => pair(t, "Columbus, OH"))
const controlCalls = () => calls.filter((c) => c.startsWith(NONSENSE)).length

;(async () => {
  // ── 1. A failed control is recorded once per city ───────────────────────
  {
    calls = []
    controlError = "Invalid API key."
    const { sb, runs } = fakeSb()
    const swept = await runSweep(searchApiAdapter({ apiKey: "k" }), [...chicago, ...columbus], [GOOGLE_JOBS], sb)
    const out = swept.flatMap((s) => s.outcomes)
    ok("one control search per city (2), not per pair (5)", controlCalls() === 2 && calls.length === 2)
    ok("every pair gets an error row with the control's error", runs.length === 5 && out.every((o) => o.status === "error" && /Invalid API key/.test(o.error ?? "")))
    ok("the first pair per city paid 1, the others 0", out.map((o) => o.requestsMade).join(",") === "1,0,0,1,0")
    ok("reused rows say so", runs.filter((r) => r.control_detail?.control_reused === true).length === 3)
    ok("nothing fetched", out.every((o) => o.foundCount === 0))
    controlError = null
  }

  // The cap refusing a control is about the budget, not the city: not cached.
  {
    const budget = new SearchBudget(0)
    let tries = 0
    const a: SourceAdapter = {
      source: "fake", filtering: "server",
      controlScope: (p) => p.location ?? "",
      control: async (): Promise<ControlResult> => { tries++; budget.take(); return { passed: true, requests: 1, detail: {} } },
      fetch: async () => ({ postings: [], requests: 0 }),
    }
    const { sb } = fakeSb()
    const out = (await runSweep(a, chicago.slice(0, 2), [GOOGLE_JOBS], sb)).flatMap((s) => s.outcomes)
    ok("a cap refusal is not cached as the city's verdict", tries === 2)
    ok("a cap refusal costs 0 requests", out.every((o) => o.status === "error" && o.requestsMade === 0 && /search cap/.test(o.error ?? "")))
  }

  // ── 2. The search cap ───────────────────────────────────────────────────
  ok("cap defaults to 60", DEFAULT_SEARCH_CAP === 60 && searchCapFromEnv(undefined) === 60 && searchCapFromEnv("abc") === 60 && searchCapFromEnv("0") === 60)
  ok("cap reads the setting", searchCapFromEnv("25") === 25)
  {
    const b = new SearchBudget(1)
    b.take()
    let threw = false
    try { b.take() } catch (e) { threw = e instanceof SearchCapReached }
    ok("take() past the cap throws and counts a refusal", threw && b.spent === 1 && b.refused === 1 && b.stopped)
  }

  // 3 Chicago pairs, 3 pages each, 1 shared control: 10 searches unbounded.
  const run = async (cap: number) => {
    calls = []
    const sent: IngestAlert[] = []
    const { sb, runs } = fakeSb()
    const r = await runGoogleJobs(sb, chicago, {
      provider: "searchapi", apiKey: "k", maxPages: 3, cap, environment: "test",
      send: async (a) => { sent.push(a) },
    })
    return { ...r, sent, runs, http: calls.length }
  }

  {
    const r = await run(10)
    ok("cap 10, need 10: everything runs", r.swept.length === 3 && r.http === 10 && r.budget.spent === 10)
    ok("reaching the cap exactly is not a stop: no alert", !r.budget.stopped && r.alert === null && r.sent.length === 0)
  }
  {
    const r = await run(6)
    ok("cap 6: never more than 6 searches sent", r.http === 6 && r.budget.spent === 6)
    ok("pair 1 whole (control + 3 pages), pair 2 cut after 2 pages, pair 3 never started", r.swept.length === 2 && r.runs.length === 2 && r.swept[1].outcomes[0].foundCount === 2)
    ok("the cut pair still keeps its pages and says the cap cut it", r.runs[1].status === "ok" && r.runs[1].fetch_detail?.cap_reached === true)
    ok("alert sent once, with the search_cap reason", r.sent.length === 1 && r.alert?.reasons[0]?.kind === "search_cap")
    const reason = r.alert!.reasons[0] as Extract<IngestAlert["reasons"][number], { kind: "search_cap" }>
    ok("alert carries cap, spent and pairs run", reason.cap === 6 && reason.spent === 6 && reason.pairsRun === 2 && reason.pairsTotal === 3)
    ok("alert subject and body name the cap", alertSubject(r.alert!) === "[SIGNAL test] ingest: searchapi stopped at its 6-search cap" && alertBody(r.alert!).includes("SEARCH CAP REACHED for searchapi: 6 of 6"))
  }
  {
    const r = await run(5)
    ok("cap 5: pair 2 starts on the last search, since its control is already cached", r.http === 5 && r.swept.length === 2)
  }
  {
    const r = await run(1)
    ok("cap 1: a pair needing a control and a fetch is not started", r.http === 0 && r.swept.length === 0 && r.runs.length === 0)
    ok("and that is a stop, with an alert", r.budget.stopped && r.sent.length === 1)
  }
  {
    calls = []
    const sent: IngestAlert[] = []
    const { sb } = fakeSb()
    await runGoogleJobs(sb, chicago, { provider: "searchapi", apiKey: "k", maxPages: 3, cap: 2, dryRun: true, send: async (a) => { sent.push(a) } })
    ok("dryRun builds the alert but does not send it", sent.length === 0)
  }

  console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
  if (failures) process.exit(1)
})().catch((e) => { console.error(e); process.exit(1) })
