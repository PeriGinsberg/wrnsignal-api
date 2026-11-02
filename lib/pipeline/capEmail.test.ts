// Run: npx tsx lib/pipeline/capEmail.test.ts
//
// The nightly cap email. Google Jobs' cap used to go out as the old ingest-sweep
// alert ("Nightly ingest sweep tripped"), which read as a sweep outside the
// pipeline; it is now a pipeline email that says it is the pipeline.

import { CAPS, capEmail } from "./tick"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const g = capEmail("google_jobs", "2026-11-02", {
  pairs: 20, pairsRun: 17, searchesEarlierTonight: 124, capRemaining: 46, searchesThisRun: 46, searchesTonight: 170, capStopped: true, capReason: "cap",
}, "production")
ok("google_jobs: subject names the pipeline step and the night", g.subject === "Job sourcing pipeline: google_jobs reached tonight's search cap (2026-11-02)")
ok("google_jobs: says it is the pipeline, not a separate sweep", g.text.includes("This is the pipeline itself, not a separate sweep"))
ok("google_jobs: no ingest-sweep wording", !/ingest sweep/i.test(g.subject + g.text))
ok("google_jobs: the night's cap", g.text.includes(`tonight's cap of ${CAPS.searches} searches`))
ok("google_jobs: splits tonight's searches across runs", g.text.includes("Searches tonight: 170 (124 in earlier runs, 46 in this one, which had 46 left)"))
ok("google_jobs: pairs left over", g.text.includes("17 of the 20 picked") && g.text.includes("The other 3 wait"))
ok("google_jobs: environment", g.text.endsWith("Environment: production"))

const last = capEmail("google_jobs", "2026-11-02", { pairs: 5, pairsRun: 5, searchesThisRun: 46, searchesTonight: 170, capRemaining: 46 }, "production")
ok("google_jobs: every pair started, the last one's pages wait", last.text.includes("The last pair's later pages wait"))

const e = capEmail("enrich", "2026-11-02", { capReason: "cap" }, "production")
ok("other steps keep the generic cap email", e.subject === "Job sourcing pipeline: enrich hit its nightly cap (2026-11-02)" && e.text.includes("Caps: "))

console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
if (failures) process.exit(1)
