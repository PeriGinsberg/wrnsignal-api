/**
 * The staleness check, run by hand.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/run-staleness.ts
 *
 * Flags:
 *   --hours N   threshold, default 36
 *   --send      actually email (default is dry run)
 *   --demo      also render the alert for the two stale states, using the real
 *               formatter and synthetic inputs, so the body is verifiable even
 *               when the system is healthy
 */

import { createClient } from "@supabase/supabase-js"
import { checkStaleness, DEFAULT_THRESHOLD_HOURS } from "../../lib/ingest/staleness"
import { stalenessSubject, stalenessBody, type StalenessAlert } from "../../lib/email/sendIngestAlert"

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment")
  process.exit(1)
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } })

const arg = (n: string, d: number) => {
  const i = process.argv.indexOf("--" + n)
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : d
}
const send = process.argv.includes("--send")
const demo = process.argv.includes("--demo")

function render(label: string, a: StalenessAlert) {
  console.log("\n" + "=".repeat(78) + "\n" + label + "\n" + "=".repeat(78))
  console.log("Subject: " + stalenessSubject(a) + "\n")
  console.log(stalenessBody(a))
}

;(async () => {
  const thresholdHours = arg("hours", DEFAULT_THRESHOLD_HOURS)
  console.log("ingest staleness check  ->  " + URL)
  console.log("  threshold : " + thresholdHours + "h")
  console.log("  mode      : " + (send ? "SEND" : "dry run"))

  const res = await checkStaleness(sb, { thresholdHours, dryRun: !send })

  console.log("\n  last ingest_runs row : " + (res.lastRunAt ?? "(table is empty)"))
  console.log("  hours since          : " + (res.hoursSince === null ? "n/a" : res.hoursSince.toFixed(2)))
  console.log("  stale                : " + res.stale)

  if (res.alert) render("ALERT WOULD BE SENT" + (send ? " (and was)" : " (dry run)"), res.alert)
  else console.log("\n  NO ALERT. Ingest wrote a row within the threshold.")

  if (demo) {
    console.log("\n\n### The two stale states, rendered with the real formatter ###")
    render("STATE A: silent for 41 hours", {
      environment: "production",
      lastRunAt: "2026-09-17T01:12:44.108Z",
      hoursSince: 41.3,
      thresholdHours,
      recent: [
        { source: "smartrecruiters", org: "Ramboll3", pair: "manager", status: "ok", at: "2026-09-17T01:12:44.108Z" },
        { source: "smartrecruiters", org: "RedBull", pair: "manager", status: "error", at: "2026-09-17T01:12:41.002Z" },
        { source: "smartrecruiters", org: "CityOfNewYork", pair: "manager", status: "error", at: "2026-09-17T01:12:37.551Z" },
      ],
    })
    render("STATE B: ingest_runs empty, never run", {
      environment: "production",
      lastRunAt: null,
      hoursSince: null,
      thresholdHours,
      recent: [],
    })
  }
})().catch((e) => {
  console.error("\nFAILED: " + e.message)
  process.exit(1)
})
