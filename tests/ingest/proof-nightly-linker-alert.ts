/**
 * Proof that a linker failure reaches the nightly alert. Dev only.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/proof-nightly-linker-alert.ts
 *
 * Runs the real nightly for SmartRecruiters as a DRY RUN (the alert is built and
 * returned, never emailed), with the linker's employer_aliases read forced to
 * fail. Expects: the sweep's own results intact, the alert carrying
 * linker_failed, a posting_link_runs error row, and the SerpApi-scoped pairs
 * left out of the SmartRecruiters sweep.
 *
 * WRITES on dev: SmartRecruiters postings and ingest_runs (as any sweep does),
 * one posting_link_runs error row.
 */
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { runNightly, alertSubject, alertBody } from "../../lib/ingest/nightly"

const PROD_REF = "ejhnokcnahauvrcbcmic"
const env: Record<string, string> = {}
const ENV_FILE = join(__dirname, "..", "..", ".env.phase0")
if (existsSync(ENV_FILE)) for (const l of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && m[2].trim()) env[m[1]] = m[2].trim() }
const URL_ = process.env.SUPABASE_URL || env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
const ref = new URL(URL_!).hostname.split(".")[0]
if (ref === PROD_REF) { console.error("Refusing to run against prod."); process.exit(1) }
const real = createClient(URL_!, KEY!, { auth: { persistSession: false } })

const FORCED = "forced failure for proof-nightly-linker-alert"
// Everything goes to the real client except two reads:
//  * the linker's employer_aliases read fails (the thing under test);
//  * ingest_boards is narrowed to SmartRecruiters. Dev's ingest_boards also
//    lists 247 Workday boards, and this build registers no Workday adapter, so
//    loadSources() refuses to start any sweep on dev. That is pre-existing and
//    separate from the linker.
const sb = new Proxy(real, {
  get(target, prop, recv) {
    if (prop === "from") {
      return (table: string) => {
        if (table === "employer_aliases") return { select: () => Promise.resolve({ data: null, error: { message: FORCED } }) }
        if (table === "ingest_boards") return { select: (cols: string) => target.from("ingest_boards").select(cols).eq("source", "smartrecruiters") }
        return target.from(table)
      }
    }
    return Reflect.get(target, prop, recv)
  },
}) as SupabaseClient

;(async () => {
  console.log(`Project ${ref} (dev)`)
  const since = new Date().toISOString()
  const res = await runNightly(sb, { environment: "dev-proof", dryRun: true, source: "smartrecruiters" })

  const pairsRun = [...new Set(res.runs.map((r) => r.pair))]
  console.log(`sweep: ${res.totals.runs} board-runs, pairs ${pairsRun.join(", ")}; found ${res.totals.found}, added ${res.totals.added}`)
  const reasons = res.alert?.reasons.map((r) => r.kind) ?? []
  console.log(`alert reasons: ${JSON.stringify(reasons)}`)
  if (res.alert) console.log(`subject: ${alertSubject(res.alert)}\n--- body (head) ---\n${alertBody(res.alert).split("\n").slice(0, 8).join("\n")}\n---`)

  const { data: errRow } = await real.from("posting_link_runs").select("status,error,triggered_by").gte("started_at", since).eq("status", "error")
  console.log(`posting_link_runs error rows since start: ${JSON.stringify(errRow)}`)

  const checks = {
    sweep_ran: res.totals.runs > 0,
    serpapi_pairs_excluded: pairsRun.every((p) => ["analyst", "engineer", "manager"].includes(p)),
    alert_has_linker_failed: reasons.includes("linker_failed"),
    error_text_carried: !!res.alert && alertBody(res.alert).includes(FORCED),
    error_row_logged: (errRow || []).some((r: any) => r.error?.includes(FORCED) && r.triggered_by === "nightly:smartrecruiters"),
  }
  console.log(`checks: ${JSON.stringify(checks)}`)
  console.log(Object.values(checks).every(Boolean) ? "RESULT: PASS" : "RESULT: FAIL")
})().catch((e) => { console.error(e); process.exit(1) })
