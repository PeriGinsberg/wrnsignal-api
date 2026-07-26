#!/usr/bin/env tsx
// Defect #2 step 3 — full end-to-end: verbEvidence(résumé) +
// extractOwnershipRequirements(REQUIREMENTS-scoped JD) + mismatch.
// Jordan fires, Sofia fires, Reyna clears (+ Omar clears). Run:
//   npx tsx app/api/jobfit/verbMismatch.e2e.test.ts

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractVerbEvidence } from "./verbEvidence"
import { extractOwnershipRequirements, detectOwnershipVerbMismatch } from "./verbMismatch"

const DIR = join(__dirname, "..", "..", "..", "Regression Testing July 2026", "cases")
function split(n: string) {
  const md = readFileSync(join(DIR, `case-${n}.input.md`), "utf8")
  const [before, jd] = md.split(/##\s*JOB\s+POSTING/i)
  return { resume: before.split(/##\s*RESUME/i)[1] || before, jd: jd || "" }
}
const overlaps = (b: any, toks: string[]) => {
  const h = (b.objectPhrase + " " + b.text).toLowerCase()
  return toks.some((t) => (t.includes(" ") ? h.includes(t) : new RegExp(`\\b${t}s?\\b`).test(h)))
}

let pass = 0, fail = 0
const ok = (name: string, cond: boolean) => { cond ? pass++ : fail++; console.log(`${cond ? "✓" : "✗"} ${name}`) }

const CASES: Array<[string, string, boolean]> = [
  ["01", "Jordan", true],  // FIRES
  ["06", "Sofia", true],   // FIRES
  ["07", "Reyna", false],  // CLEARS (control, risks: [])
  ["08", "Omar", false],   // CLEARS (must not fire)
]

for (const [n, name, wantFire] of CASES) {
  const { resume, jd } = split(n)
  const bullets = extractVerbEvidence(resume)
  const reqs = extractOwnershipRequirements(jd)
  const res = detectOwnershipVerbMismatch(jd, bullets)

  console.log(`\n═══ ${n} ${name} ═══   requirements pulled: [${reqs.map((r) => r.object).join(" | ")}]`)
  for (const r of reqs) {
    const relevant = bullets.filter((b) => b.scope === "function" && overlaps(b, r.conceptTokens))
    console.log(`  requirement "${r.object}":`)
    if (!relevant.length) { console.log(`     (no function-scope evidence → cannot fire)`); continue }
    for (const b of relevant) console.log(`     [${b.verbClass.padEnd(12)}] ${b.text.slice(0, 66)}`)
    const own = relevant.some((b) => b.verbClass === "ownership")
    const con = relevant.some((b) => b.verbClass === "contribution")
    console.log(`     → ${own ? "CLEARED by ownership" : con ? "FIRES (contribution, no ownership)" : "neutral-only → no fire"}`)
  }
  console.log(`  RESULT: ${res.fires ? "FIRES" : "clears"}  (want ${wantFire ? "FIRES" : "clears"})`)
  ok(`${n} ${name} ${wantFire ? "fires" : "clears"}`, res.fires === wantFire)
}

// Constraint 2: headerless posting falls back to the whole posting (not zero).
const proseOwn = "We need someone to take real ownership of the measurement function; you will own it."
ok("headerless posting → falls back to whole (pulls the ownership demand)",
  extractOwnershipRequirements(proseOwn).some((r) => r.object.includes("measurement function")))

console.log(`\n${pass}/${pass + fail} end-to-end assertions passed`)
process.exit(fail > 0 ? 1 : 0)
