// Run: npx tsx lib/email/sendIngestAlert.test.ts
//
// The ingest alert's subject and body, including a cross-source linker failure
// (lib/ingest/nightly.ts adds it after the sweep). Pure functions: nothing is
// sent, and Postmark is never imported.

import { alertBody, alertSubject, type IngestAlert } from "./sendIngestAlert"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const base = { lines: ["  grnhse/point72  \"analyst\"  ok  ctrl=true  found=  3  added=   0  req=1"], totals: { pairs: 25, boards: 5, runs: 125, found: 410, added: 12, requests: 130 }, durationMs: 61000 }

const linkerOnly: IngestAlert = { environment: "production", reasons: [{ kind: "linker_failed", error: "load employer_aliases: relation does not exist" }], ...base }
ok("linker-only subject", alertSubject(linkerOnly) === "[SIGNAL] ingest: linker failed")
const body = alertBody(linkerOnly)
ok("body names the linker failure and the error", body.includes("CROSS-SOURCE LINKER FAILED") && body.includes("load employer_aliases: relation does not exist"))
ok("body says the sweep's results stand", body.includes("unaffected"))
ok("body still carries the sweep totals", body.includes("410 found, 12 added"))

const both: IngestAlert = { environment: "preview", reasons: [{ kind: "run_error", rows: [{ source: "grnhse", org: "point72", pair: "analyst", error: "HTTP 500" }] }, { kind: "linker_failed", error: "x" }], ...base }
ok("combined subject lists both", alertSubject(both) === "[SIGNAL preview] ingest: 1 error, linker failed")

console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
if (failures) process.exit(1)
