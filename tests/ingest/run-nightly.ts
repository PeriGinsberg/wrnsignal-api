/**
 * Run the nightly ingest sweep once, by hand.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/run-nightly.ts
 *
 * DRY RUN BY DEFAULT: it prints the alert it would send and sends nothing.
 * Pass --send to actually email. Writes postings and ingest_runs either way,
 * and deletes nothing.
 */

import { createClient } from "@supabase/supabase-js"
import { runNightly, alertSubject, alertBody } from "../../lib/ingest/nightly"
import { loadSources } from "../../lib/ingest/boards"

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment")
  process.exit(1)
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } })
const send = process.argv.includes("--send")
const srcIdx = process.argv.indexOf("--source")
const onlySource = srcIdx >= 0 ? process.argv[srcIdx + 1] : undefined

;(async () => {
  console.log("nightly ingest sweep  ->  " + URL)
  for (const s of await loadSources(sb)) {
    if (onlySource && s.adapter.source !== onlySource) continue
    console.log("  " + s.adapter.source.padEnd(17) + "filtering=" + s.adapter.filtering.padEnd(8) + s.boards.length + " boards")
  }
  if (onlySource) console.log("  source : " + onlySource)
  console.log("  mode   : " + (send ? "SEND" : "dry run, prints the alert instead of sending"))
  console.log("\nrunning...\n")

  const res = await runNightly(sb, { dryRun: !send, source: onlySource })

  console.log("  pairs    " + res.totals.pairs)
  console.log("  boards   " + res.totals.boards)
  console.log("  runs     " + res.totals.runs)
  console.log("  found    " + res.totals.found)
  console.log("  added    " + res.totals.added)
  console.log("  requests " + res.totals.requests)
  console.log("  duration " + Math.round(res.durationMs / 1000) + "s")

  console.log("\n  every board-run:")
  for (const r of res.runs) {
    console.log(
      "    " + (r.source + "/" + r.org).padEnd(30) + ('"' + r.pair + '"').padEnd(14) +
      r.outcome.status.padEnd(9) + "ctrl=" + String(r.outcome.controlPassed).padEnd(6) +
      "found=" + String(r.outcome.foundCount).padStart(4) + "  added=" + String(r.outcome.addedCount).padStart(4) +
      "  req=" + r.outcome.requestsMade + (r.outcome.error ? "   " + r.outcome.error.slice(0, 80) : "")
    )
  }

  console.log("\n\n" + "=".repeat(78))
  if (!res.alert) {
    console.log("NO ALERT. None of the three conditions tripped:")
    console.log("  total found > 0, no control_passed = false, no status = error.")
    console.log("(Nothing would be emailed. Liveness is the ingest_runs rows themselves.)")
  } else {
    console.log("ALERT WOULD BE SENT" + (send ? " (and was)" : " (dry run, not sent)"))
    console.log("=".repeat(78))
    console.log("\nSubject: " + alertSubject(res.alert))
    console.log("\n" + alertBody(res.alert))
  }
  console.log("=".repeat(78))
})().catch((e) => {
  console.error("\nFAILED: " + e.message)
  process.exit(1)
})
