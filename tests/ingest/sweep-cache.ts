/**
 * Per-sweep board caching: does it save requests without changing results?
 *
 * Runs the same three pairs across the same five Greenhouse boards twice --
 * once with no cache (a bare runPair per pair) and once through runSweep --
 * and compares. The cache is only worth having if found counts are IDENTICAL:
 * a cache that changes what is found is not a cache, it is a bug.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/sweep-cache.ts
 *
 * WRITES: postings and ingest_runs. Point it at dev.
 */

import { createClient } from "@supabase/supabase-js"
import { greenhouseAdapter } from "../../lib/ingest/greenhouse"
import { runPair, runSweep, type BoardOutcome } from "../../lib/ingest/runner"
import type { IngestPair } from "../../lib/ingest/types"

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment")
  process.exit(1)
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } })

const ORGS = ["capco", "point72", "janestreet", "mediabrands", "scaleai"]
const PAIRS: IngestPair[] = [
  { id: null, title: "analyst", location: "New York" },
  { id: null, title: "engineer", location: "New York" },
  { id: null, title: "manager", location: "New York" },
]

let failures = 0
const assert = (name: string, ok: boolean, note?: string) => {
  if (!ok) failures++
  console.log("  " + (ok ? "PASS" : "FAIL") + "  " + name + (!ok && note ? "\n        " + note : ""))
}

function grid(label: string, runs: { pair: IngestPair; outcomes: BoardOutcome[] }[], show: (o: BoardOutcome) => number) {
  console.log("\n  " + label)
  console.log("    " + "pair".padEnd(12) + ORGS.map((o) => o.slice(0, 11).padStart(12)).join("") + "row".padStart(8))
  let total = 0
  for (const r of runs) {
    let rowTotal = 0
    const cells = ORGS.map((org) => {
      const o = r.outcomes.find((x) => x.org === org)
      const v = o ? show(o) : 0
      rowTotal += v
      return String(v).padStart(12)
    })
    total += rowTotal
    console.log("    " + r.pair.title.padEnd(12) + cells.join("") + String(rowTotal).padStart(8))
  }
  console.log("    " + "SWEEP TOTAL".padEnd(12) + "".padStart(ORGS.length * 12) + String(total).padStart(8))
  return total
}

;(async () => {
  console.log("sweep cache  ->  " + URL)
  console.log("  source : " + greenhouseAdapter.source + "  (filtering=" + greenhouseAdapter.filtering + ")")
  console.log("  pairs  : " + PAIRS.map((p) => p.title).join(", "))
  console.log("  boards : " + ORGS.join(", "))

  // ---- UNCACHED: each pair on its own, no cache handed in
  console.log("\n\n=== UNCACHED (runPair per pair) ===")
  const t0 = Date.now()
  const uncached: { pair: IngestPair; outcomes: BoardOutcome[] }[] = []
  for (const pair of PAIRS) {
    uncached.push({ pair, outcomes: await runPair(greenhouseAdapter, pair, ORGS, sb) })
  }
  const uncachedMs = Date.now() - t0
  const uReq = grid("requests_made", uncached, (o) => o.requestsMade)
  grid("found_count", uncached, (o) => o.foundCount)
  console.log("\n    wall clock: " + uncachedMs + "ms")

  // ---- CACHED: one sweep, boards downloaded once
  console.log("\n\n=== CACHED (runSweep) ===")
  const t1 = Date.now()
  const cached = await runSweep(greenhouseAdapter, PAIRS, ORGS, sb)
  const cachedMs = Date.now() - t1
  const cReq = grid("requests_made", cached, (o) => o.requestsMade)
  grid("found_count", cached, (o) => o.foundCount)
  console.log("\n    wall clock: " + cachedMs + "ms")

  // ---- the comparison that matters
  console.log("\n\n=== COMPARISON ===\n")
  console.log("  requests: uncached " + uReq + "  ->  cached " + cReq +
    "   (saved " + (uReq - cReq) + ", " + Math.round(((uReq - cReq) / (uReq || 1)) * 100) + "%)")
  console.log("  wall clock: " + uncachedMs + "ms  ->  " + cachedMs + "ms\n")

  for (const pair of PAIRS) {
    const u = uncached.find((r) => r.pair.title === pair.title)!
    const c = cached.find((r) => r.pair.title === pair.title)!
    for (const org of ORGS) {
      const uo = u.outcomes.find((x) => x.org === org)!
      const co = c.outcomes.find((x) => x.org === org)!
      assert(
        pair.title + " / " + org + ": found identical (" + uo.foundCount + ")",
        uo.foundCount === co.foundCount,
        "uncached found=" + uo.foundCount + ", cached found=" + co.foundCount
      )
      assert(
        pair.title + " / " + org + ": control verdict identical",
        uo.controlPassed === co.controlPassed,
        "uncached control_passed=" + uo.controlPassed + ", cached=" + co.controlPassed
      )
    }
  }

  assert("cached sweep used fewer requests", cReq < uReq, "cached " + cReq + " vs uncached " + uReq)
  assert(
    "cached sweep downloaded each board exactly once",
    cReq === ORGS.length,
    "expected " + ORGS.length + " requests for " + ORGS.length + " boards, got " + cReq
  )

  console.log(failures === 0 ? "\nALL CASES AS EXPECTED\n" : "\n" + failures + " CASE(S) NOT AS EXPECTED\n")
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => {
  console.error("\nFAILED: " + e.message)
  process.exit(1)
})
