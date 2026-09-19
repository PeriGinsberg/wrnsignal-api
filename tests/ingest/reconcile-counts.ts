/**
 * Asserts the ingest_runs arithmetic closes:
 *
 *   found_count = added_count + refound_count + intra_run_duplicate_count
 *
 * on every status = 'ok' row, and that the classification means what it says.
 *
 * Runs the same pair TWICE. The first pass is mostly `added`, the second pass
 * must be entirely `refound` plus whatever the board duplicates internally, and
 * must add nothing. A run that reported everything as `added` on both passes
 * would satisfy the identity and still be wrong, so the second pass is what
 * actually pins the classification.
 *
 * Requires 20260918_ingest_runs_per_board.sql to be applied.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/reconcile-counts.ts
 *
 * WRITES: postings and ingest_runs. Deletes nothing. Point it at dev.
 */

import { createClient } from "@supabase/supabase-js"
import { smartRecruitersAdapter } from "../../lib/ingest/smartrecruiters"
import { runPair, type BoardOutcome } from "../../lib/ingest/runner"
import type { IngestPair } from "../../lib/ingest/types"

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment")
  process.exit(1)
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } })

const ORGS = ["AECOM2", "CityOfNewYork"]
const TITLE = "coordinator"
const CITY = "New York"

let failures = 0
function assert(name: string, ok: boolean, note?: string) {
  if (!ok) failures++
  console.log("  " + (ok ? "PASS" : "FAIL") + "  " + name + (!ok && note ? "\n        " + note : ""))
}

function line(o: BoardOutcome) {
  return (
    "    " + o.org.padEnd(16) +
    "status=" + o.status.padEnd(8) +
    "found=" + String(o.foundCount).padStart(4) +
    "  added=" + String(o.addedCount).padStart(4) +
    "  refound=" + String(o.refoundCount).padStart(4) +
    "  dup=" + String(o.intraRunDuplicateCount).padStart(3)
  )
}

/** The identity, checked against what the runner returned. */
function checkReconcile(label: string, outcomes: BoardOutcome[]) {
  for (const o of outcomes) {
    if (o.status !== "ok") continue
    const sum = o.addedCount + o.refoundCount + o.intraRunDuplicateCount
    assert(
      label + " " + o.org + ": found = added + refound + dup",
      o.foundCount === sum,
      "found=" + o.foundCount + " but added+refound+dup=" + sum + " (off by " + (o.foundCount - sum) + ")"
    )
  }
}

/** The identity, checked again against what actually landed in the table. */
async function checkStoredRows(label: string) {
  const { data, error } = await sb
    .from("ingest_runs")
    .select("org_slug, status, found_count, added_count, refound_count, intra_run_duplicate_count, control_passed")
    .eq("pair_title", TITLE)
    .order("created_at", { ascending: false })
    .limit(ORGS.length)
  if (error) throw new Error(error.message)
  const rows = data || []
  assert(label + ": one ingest_runs row per board", rows.length === ORGS.length,
    "got " + rows.length + " rows for " + ORGS.length + " boards")
  for (const r of rows) {
    assert(label + " stored row has org_slug", !!r.org_slug, "org_slug is null")
    if (r.status !== "ok") continue
    const sum = r.added_count + r.refound_count + r.intra_run_duplicate_count
    assert(
      label + " stored " + r.org_slug + ": found = added + refound + dup",
      r.found_count === sum,
      "stored found=" + r.found_count + " but sum=" + sum
    )
  }
  return rows
}

;(async () => {
  console.log("reconcile-counts  ->  " + URL)
  console.log("  pair   : " + JSON.stringify(TITLE) + " @ " + JSON.stringify(CITY))
  console.log("  boards : " + ORGS.join(", "))

  // NOTHING IS DELETED FROM ingest_runs, here or anywhere. It is the record of
  // what ingest did, and a test that tidies up after itself removes evidence of
  // real runs: 193 SmartRecruiters adds are already unaccounted for because an
  // earlier version of this file deleted its own rows. The assertions below
  // read the most recent rows for this pair rather than assuming an empty table.
  const pair: IngestPair = { id: null, title: TITLE, location: CITY }

  console.log("\n=== PASS 1 ===")
  const first = await runPair(smartRecruitersAdapter, pair, ORGS, sb)
  for (const o of first) console.log(line(o))
  console.log("")
  checkReconcile("pass 1", first)
  await checkStoredRows("pass 1")

  await new Promise((r) => setTimeout(r, 1500))

  console.log("\n=== PASS 2 (same pair, unchanged) ===")
  const second = await runPair(smartRecruitersAdapter, pair, ORGS, sb)
  for (const o of second) console.log(line(o))
  console.log("")
  checkReconcile("pass 2", second)
  await checkStoredRows("pass 2")

  console.log("")
  for (const o of second) {
    if (o.status !== "ok") continue
    // Everything pass 2 saw was already in the table, so nothing can be new.
    assert(
      "pass 2 " + o.org + ": added nothing",
      o.addedCount === 0,
      "added=" + o.addedCount + ", so a posting ingested in pass 1 was not matched in pass 2. The fingerprint is not stable."
    )
    // And the same postings must come back, not a different set.
    const twin = first.find((f) => f.org === o.org)
    assert(
      "pass 2 " + o.org + ": found the same number as pass 1",
      !!twin && twin.foundCount === o.foundCount,
      "pass 1 found=" + twin?.foundCount + ", pass 2 found=" + o.foundCount
    )
    assert(
      "pass 2 " + o.org + ": refound accounts for everything pass 1 added",
      !!twin && o.refoundCount >= twin.addedCount,
      "pass 1 added=" + twin?.addedCount + " but pass 2 only refound=" + o.refoundCount
    )
  }

  console.log("\ningest_runs rows kept (nothing is ever deleted from that table)")
  console.log(failures === 0 ? "\nALL CASES AS EXPECTED\n" : "\n" + failures + " CASE(S) NOT AS EXPECTED\n")
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => {
  console.error("\nFAILED: " + e.message)
  process.exit(1)
})
