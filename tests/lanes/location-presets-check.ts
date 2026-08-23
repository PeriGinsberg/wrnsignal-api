// tests/lanes/location-presets-check.ts
//
// Every LOCATIONS preset in lib/hiringcafe.ts, run through runLane() as a real
// lane. Live network, no DB — dryRun stops before the upsert.
//
// Run:
//   npx tsx tests/lanes/location-presets-check.ts
//   npx tsx tests/lanes/location-presets-check.ts columbus tampa   # a subset
//
// Why this exists: a place payload that is wrong or truncated is NOT rejected.
// The board answers HTTP 200 with zero hits, which is indistinguishable from a
// quiet market (lib/hiringcafe.ts, note 3). Only an actual search proves a
// preset works, so a preset added without one of these runs is unverified.
//
// A zero count is therefore treated as failure. The query is deliberately broad
// ("marketing", 25mi, posted <= 29d) so that in any real metro a healthy preset
// returns hundreds — a genuine zero would mean the market, not the payload.
//
// Exits 1 on any preset that returns nothing or throws.

import { LOCATIONS } from "@/lib/hiringcafe"
import { runLane, type Lane } from "@/lib/laneRunner"

const QUERY = "marketing"

const only = process.argv.slice(2)
const keys = only.length ? only : Object.keys(LOCATIONS)

const unknown = keys.filter((k) => !LOCATIONS[k])
if (unknown.length) {
  console.error(`unknown preset(s): ${unknown.join(", ")}`)
  process.exit(1)
}

// A lane with exactly one title and no filters: the fewest moving parts that
// still goes through resolvePresets → buildSearchState → fetchJobs.
const laneFor = (preset: string): Lane => ({
  id: `preset-check-${preset}`,
  name: `preset check ${preset}`,
  titles: [QUERY],
  keyword: null,
  location: { presets: [preset], radius_miles: 25, days_posted: 29 },
  years_max: null,
  companies: [],
  exclusions: {},
  filters: null,
})

const failures: string[] = []

async function main() {
  for (const key of keys) {
    const label = String(LOCATIONS[key].formatted_address ?? key)
    try {
      const res = await runLane(laneFor(key), null as any, { dryRun: true })
      const [t] = res.perTitle
      const line = `${key.padEnd(16)} ${String(t.available).padStart(5)} available  ${String(t.kept).padStart(3)} kept  ${label}`
      if (t.available === 0) {
        failures.push(`${key}: 0 results — payload is probably wrong, not the market`)
        console.log(`  ✗ ${line}`)
      } else {
        console.log(`  ✓ ${line}`)
      }
    } catch (err: any) {
      failures.push(`${key}: ${err?.message || String(err)}`)
      console.log(`  ✗ ${key.padEnd(16)} ${err?.message || String(err)}`)
    }
  }

  console.log()
  if (failures.length) {
    console.log(`${failures.length}/${keys.length} FAILED`)
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
  console.log(`all ${keys.length} presets returned results`)
}

main()
