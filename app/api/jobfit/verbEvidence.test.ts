#!/usr/bin/env tsx
// Tests for the per-bullet verb evidence extractor (defect #2, step 1).
// Prints the verb-class table for the 8 résumés + asserts the load-bearing
// classifications. No posting, no mismatch logic yet. Run:
//   npx tsx app/api/jobfit/verbEvidence.test.ts

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractVerbEvidence, type VerbBullet } from "./verbEvidence"

const CASES_DIR = join(__dirname, "..", "..", "..", "Regression Testing July 2026", "cases")
function resume(n: string): string {
  const txt = readFileSync(join(CASES_DIR, `case-${n}.input.md`), "utf8")
  const before = txt.split(/##\s*JOB\s+POSTING/i)[0]
  return before.split(/##\s*RESUME/i)[1] || before
}
const NAMES: Record<string, string> = {
  "01": "Jordan", "02": "Priya", "03": "Marcus", "04": "Dana",
  "05": "Tyler", "06": "Sofia", "07": "Reyna", "08": "Omar",
}

const ev: Record<string, VerbBullet[]> = {}
for (const n of Object.keys(NAMES)) ev[n] = extractVerbEvidence(resume(n))

console.log("── per-bullet verb evidence ──\n")
for (const n of Object.keys(NAMES)) {
  console.log(`${n} ${NAMES[n]}`)
  for (const b of ev[n]) {
    console.log(`   [${b.verbClass.padEnd(12)} ${b.scope.padEnd(8)}] ${b.leadingVerb ?? "—"}  ·  ${b.text.slice(0, 70)}`)
  }
  console.log("")
}

// ── assertions ───────────────────────────────────────────────────────────────
let pass = 0, fail = 0
function ok(name: string, cond: boolean) {
  if (cond) pass++
  else fail++
  console.log(`${cond ? "✓" : "✗"} ${name}`)
}
const find = (n: string, sub: string) => ev[n].find((b) => b.text.toLowerCase().includes(sub.toLowerCase()))

// Jordan — the trap: ownership verbs, but on TASK objects; the measurement-function
// bullet is contribution.
const jMMM = find("01", "marketing mix model")!
ok("Jordan 'Assisted…marketing mix model' = contribution + function", jMMM.verbClass === "contribution" && jMMM.scope === "function")
const jRep = find("01", "recurring reporting")!
ok("Jordan 'Built recurring reporting' = ownership + TASK (does not count for X)", jRep.verbClass === "ownership" && jRep.scope === "task")
const jTax = find("01", "taxonomy")!
ok("Jordan 'Maintained…taxonomy' = neutral + task", jTax.verbClass === "neutral" && jTax.scope === "task")
ok("Jordan has NO ownership bullet at function scope",
  !ev["01"].some((b) => b.verbClass === "ownership" && b.scope === "function"))

// Reyna — ownership on the function; leading-verb rule holds on 'Defined … jointly'
const rWh = find("07", "data warehouse")!
ok("Reyna 'Built the data warehouse…owned the BI layer' = ownership + function", rWh.verbClass === "ownership" && rWh.scope === "function")
const rDef = find("07", "jointly with RevOps")!
ok("Reyna 'Defined…jointly with RevOps' = ownership (leading-verb rule, not demoted)", rDef.verbClass === "ownership")
ok("Reyna HAS ≥1 ownership bullet at function scope (will clear the risk)",
  ev["07"].some((b) => b.verbClass === "ownership" && b.scope === "function"))

// Sofia — all-contribution on function objects
const sRoad = find("06", "quarterly roadmap")!
ok("Sofia 'Contributed to the quarterly roadmap' = contribution + function", sRoad.verbClass === "contribution" && sRoad.scope === "function")
const sPL = find("06", "product line")!
ok("Sofia 'Supported the launch…product line' = contribution + function", sPL.verbClass === "contribution" && sPL.scope === "function")
ok("Sofia has NO ownership bullet at function scope",
  !ev["06"].some((b) => b.verbClass === "ownership" && b.scope === "function"))

console.log(`\n${pass}/${pass + fail} verb-evidence assertions passed`)
process.exit(fail > 0 ? 1 : 0)
