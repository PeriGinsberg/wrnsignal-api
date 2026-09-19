/**
 * Phase 1 step 2 run: one pair, five SmartRecruiters boards.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/run-smartrecruiters.ts
 *
 * Flags:
 *   --title "..."     default "analyst"
 *   --city  "..."     default "New York"
 *   --orgs  a,b,c     default the five below
 *
 * WRITES: postings and ingest_runs. Point it at dev.
 */

import { createClient } from "@supabase/supabase-js"
import { smartRecruitersAdapter } from "../../lib/ingest/smartrecruiters"
import { runPair } from "../../lib/ingest/runner"
import type { IngestPair } from "../../lib/ingest/types"

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment")
  process.exit(1)
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } })

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf("--" + name)
  const next = process.argv[i + 1]
  return i >= 0 && next && !next.startsWith("--") ? next : fallback
}

// Five real SmartRecruiters boards taken from lane_results, largest first.
const DEFAULT_ORGS = ["AECOM2", "HMGroup", "CityOfNewYork", "RedBull", "Ramboll3"]

;(async () => {
  const title = arg("title", "analyst")
  const city = arg("city", "New York")
  const orgs = arg("orgs", DEFAULT_ORGS.join(",")).split(",").map((s) => s.trim()).filter(Boolean)

  const pair: IngestPair = { id: null, title, location: city }

  console.log("ingest run  ->  " + URL)
  console.log("  source : " + smartRecruitersAdapter.source)
  console.log("  pair   : title=" + JSON.stringify(title) + "  location=" + JSON.stringify(city))
  console.log("  boards : " + orgs.join(", "))
  console.log("\nrunning...\n")

  const before = Date.now()
  const outcomes = await runPair(smartRecruitersAdapter, pair, orgs, sb)

  console.log("  " + "board".padEnd(16) + "status".padEnd(10) + "ctrl".padEnd(7) + "req".padEnd(6) +
    "found".padEnd(7) + "added".padEnd(7) + "refound".padEnd(9) + "dup")
  for (const o of outcomes) {
    console.log(
      "  " + o.org.padEnd(16) + o.status.padEnd(10) + String(o.controlPassed).padEnd(7) +
      String(o.requestsMade).padEnd(6) + String(o.foundCount).padEnd(7) + String(o.addedCount).padEnd(7) +
      String(o.refoundCount).padEnd(9) + String(o.intraRunDuplicateCount)
    )
    if (o.error) console.log("      error: " + o.error)
  }
  const tot = outcomes.reduce((a, o) => ({
    req: a.req + o.requestsMade, found: a.found + o.foundCount, added: a.added + o.addedCount,
    refound: a.refound + o.refoundCount, dup: a.dup + o.intraRunDuplicateCount,
  }), { req: 0, found: 0, added: 0, refound: 0, dup: 0 })
  console.log("  " + "TOTAL".padEnd(16) + "".padEnd(10) + "".padEnd(7) + String(tot.req).padEnd(6) +
    String(tot.found).padEnd(7) + String(tot.added).padEnd(7) + String(tot.refound).padEnd(9) + tot.dup)
  console.log("  wall clock     : " + (Date.now() - before) + "ms")

  // ---- the ingest_runs rows this produced
  const { data, error } = await sb
    .from("ingest_runs")
    .select("id, created_at, source, org_slug, pair_title, pair_location, status, requests_made, found_count, added_count, refound_count, intra_run_duplicate_count, control_passed, control_detail, error, duration_ms")
    .eq("source", smartRecruitersAdapter.source)
    .order("created_at", { ascending: false })
    .limit(orgs.length)
  if (error) throw new Error(error.message)

  console.log("\n\n=== ingest_runs (most recent " + (data?.length ?? 0) + ", one per board) ===")
  for (const r of data || []) {
    const sum = r.added_count + r.refound_count + r.intra_run_duplicate_count
    console.log("\n  id             " + r.id)
    console.log("  source/board   " + r.source + " / " + r.org_slug)
    console.log("  pair           " + JSON.stringify(r.pair_title) + " @ " + JSON.stringify(r.pair_location))
    console.log("  status         " + r.status + "   control_passed " + r.control_passed)
    console.log("  requests_made  " + r.requests_made + "   duration_ms " + r.duration_ms)
    console.log("  found          " + r.found_count +
      "  =  added " + r.added_count + " + refound " + r.refound_count + " + dup " + r.intra_run_duplicate_count +
      "  =  " + sum + (r.found_count === sum ? "   reconciles" : "   DOES NOT RECONCILE"))
    console.log("  error          " + (r.error ?? "(null)"))
    const c: any = r.control_detail
    if (c) console.log("  control        term=" + c.term + "  totalFound=" + c.totalFound + "  returned=" + c.returned)
  }

  const { count } = await sb.from("postings").select("id", { count: "exact", head: true }).eq("source", "smartrecruiters")
  console.log("\n  postings rows with source=smartrecruiters: " + count)
})().catch((e) => {
  console.error("\nFAILED: " + e.message)
  process.exit(1)
})
