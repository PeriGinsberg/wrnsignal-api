#!/usr/bin/env tsx
// Standalone tests for defect #2 step 2: ownership-requirement extraction +
// the object-scoped mismatch fire logic. Hand-built bullets isolate the logic;
// real JD text exercises extraction. No résumé extractor, no wiring. Run:
//   npx tsx app/api/jobfit/verbMismatch.test.ts

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractOwnershipRequirements, detectOwnershipVerbMismatch } from "./verbMismatch"
import type { VerbBullet, VerbClass, BulletScope } from "./verbEvidence"

const CASES_DIR = join(__dirname, "..", "..", "..", "Regression Testing July 2026", "cases")
const jd = (n: string) => readFileSync(join(CASES_DIR, `case-${n}.input.md`), "utf8").split(/##\s*JOB\s+POSTING/i)[1] || ""

let pass = 0, fail = 0
function ok(name: string, cond: boolean) {
  if (cond) pass++
  else fail++
  console.log(`${cond ? "✓" : "✗"} ${name}`)
}
function b(verbClass: VerbClass, scope: BulletScope, objectPhrase: string): VerbBullet {
  return { text: objectPhrase, leadingVerb: null, verbClass, objectPhrase, objectHeadNoun: null, scope }
}

// ── Step A: ownership-requirement extraction on real JDs ─────────────────────
console.log("ownership-requirement extraction")
const thread = extractOwnershipRequirements(jd("01")).map((r) => r.object)
ok("Threadline extracts 'measurement function'", thread.some((o) => o.includes("measurement function")))
const nimbus = extractOwnershipRequirements(jd("06")).map((r) => r.object)
ok("Nimbus extracts a roadmap/product-line object", nimbus.some((o) => /roadmap|product line/.test(o)))
ok("Nimbus extracts 'strategy' (driving … you personally defined)", nimbus.some((o) => o.includes("strategy")))
const fernwood = extractOwnershipRequirements(jd("08")).map((r) => r.object)
ok("Fernwood extracts a 'model lifecycle' object", fernwood.some((o) => o.includes("model lifecycle")))
// A support-only posting yields no ownership requirement:
ok("no-ownership posting → 0 requirements", extractOwnershipRequirements("Requirements:\nSupport the team. Help with reporting.").length === 0)

// ── Steps C–D: fire logic on hand-built bullets (X = measurement function) ───
console.log("\nmismatch fire logic (X = measurement function)")
const JD_OWN = "Requirements:\nDemonstrated ownership of a measurement function."
const JD_NONE = "Requirements:\nSupport the team and help with reporting."

const contribFn = b("contribution", "function", "the rollout of a marketing mix model")
const ownFn = b("ownership", "function", "the marketing data warehouse and dbt models")
const ownTask = b("ownership", "task", "recurring reporting")
const unrelated = b("contribution", "function", "the office relocation project")

ok("contribution-only on X → FIRES", detectOwnershipVerbMismatch(JD_OWN, [contribFn]).fires === true)
ok("one ownership verb on X → CLEARS (Guard 3)", detectOwnershipVerbMismatch(JD_OWN, [contribFn, ownFn]).fires === false)
ok("ownership at TASK scope does NOT clear (the trap) → still FIRES", detectOwnershipVerbMismatch(JD_OWN, [contribFn, ownTask]).fires === true)
ok("owned-3-supported-1 on X → CLEARS (mixed is not a faker)", detectOwnershipVerbMismatch(JD_OWN, [ownFn, ownFn, ownFn, contribFn]).fires === false)
ok("no ownership requirement in JD → never fires (Guard 1)", detectOwnershipVerbMismatch(JD_NONE, [contribFn]).fires === false)
ok("no X-relevant bullet → no fire (relevant=0)", detectOwnershipVerbMismatch(JD_OWN, [unrelated]).fires === false)
ok("contribution on X + ownership only on a DIFFERENT (unrelated) object → FIRES",
  detectOwnershipVerbMismatch(JD_OWN, [contribFn, b("ownership", "function", "the office relocation project")]).fires === true)

console.log(`\n${pass}/${pass + fail} step-2 assertions passed`)
process.exit(fail > 0 ? 1 : 0)
