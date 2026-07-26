#!/usr/bin/env tsx
// ACCEPTANCE GATE for the frozen résumé-evidence fixture. Run after every freeze:
//   npx tsx "Regression Testing July 2026/verify-frozen-evidence.ts"
//
// LESSON (2026-07): an earlier freeze greened on a PARTIAL field diff while the
// LLM read Jordan's scope as task (dropping his ownership-verb risk) and Priya's
// degree as null (UNKNOWN, not UNMET). A green field diff is NOT proof of a good
// freeze. So this gate has two parts with an explicit hierarchy:
//
//   PART 1 (informational): COMPLETE field diff, LLM(frozen) vs regex, every
//     field a detector consumes. It SURFACES divergences — it NEVER passes/fails
//     on its own. Divergence is expected (e.g. domainYears is richer under LLM).
//
//   PART 2 (AUTHORITY): behavioral. Hard asserts on the fires the golden set
//     depends on, PLUS the full `validate.py --run` verdict gate (8/9, and the
//     only permitted failure is case 08's known, out-of-scope verdict-band
//     defect). If PART 2 fails, the freeze is rejected regardless of PART 1.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { resolveResumeEvidence } from "../app/api/jobfit/llmResumeExtractor"
import { extractProfileEvidence } from "../app/api/jobfit/profileEvidence"
import { extractVerbEvidence } from "../app/api/jobfit/verbEvidence"
import { detectOwnershipVerbMismatch } from "../app/api/jobfit/verbMismatch"

const DIR = __dirname
const CASES = ["01", "02", "03", "04", "05", "06", "07", "08", "09"]
const frozen = JSON.parse(readFileSync(join(DIR, "resume-evidence.frozen.json"), "utf8"))

function splitCase(n: string) {
  const md = readFileSync(join(DIR, "cases", `case-${n}.input.md`), "utf8")
  const parts = md.split(/^\s*##\s*JOB\s+POSTING\s*$/im)
  const rp = parts[0]
  const jt = (parts[1] || "").trim()
  const m = rp.match(/^\s*##\s*RESUME\s*$/im)
  const body = m ? rp.slice((m.index || 0) + m[0].length) : rp
  return { pt: "Resume:\n" + body.replace(/\n-{3,}\s*$/, "\n").trim(), jt }
}

const PE_FIELDS = ["totalYears", "domainYears", "managerOfManagersYears", "toolsInExperience", "toolsInSkillsOnly", "licensesHeld", "clearancesHeld", "citizenshipStated", "degreeHeld", "waiverOnFile", "skillRecency"]
const norm = (v: any) => JSON.stringify(v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : Array.isArray(v) ? [...v].sort() : v)
const vbSig = (a: any[]) => JSON.stringify(a.map((b) => [b.leadingVerb, b.verbClass, b.scope, b.objectHeadNoun]))

async function main() {
  // ── PART 1 (informational): complete field diff ────────────────────────────
  console.log("── PART 1 (informational): complete LLM(frozen)-vs-regex field diff ──")
  for (const n of CASES) {
    const { pt } = splitCase(n)
    const L: any = await resolveResumeEvidence(pt, { llm: { cache: frozen, allowLive: false } })
    const rE: any = extractProfileEvidence(pt)
    const rV = extractVerbEvidence(pt)
    if (L.source !== "llm") { console.log(`  ⚠ case ${n}: NOT sourced from LLM (cache miss?) — freeze incomplete`); continue }
    const diffs = PE_FIELDS.filter((f) => norm(L.profileEvidence[f]) !== norm(rE[f]))
    if (vbSig(L.verbBullets) !== vbSig(rV)) diffs.push("verbBullets")
    console.log(`  case ${n}: ${diffs.length ? "diverges: " + diffs.join(", ") : "identical"}`)
  }
  console.log("  (divergence is expected and acceptable — PART 2 is the gate)")

  // ── PART 2 (AUTHORITY): behavioral ─────────────────────────────────────────
  console.log("\n── PART 2 (AUTHORITY): behavioral fire-presence + golden verdict run ──")
  const fails: string[] = []

  // (a) evidence/detector-level fire asserts the golden set depends on
  const c01 = splitCase("01")
  const e01: any = await resolveResumeEvidence(c01.pt, { llm: { cache: frozen, allowLive: false } })
  const d01 = detectOwnershipVerbMismatch(c01.jt, e01.verbBullets)
  console.log(`  [assert] case 01 ownership-verb risk fires: ${d01.fires} (on "${d01.firedOn}")`)
  if (!d01.fires) fails.push("case 01 ownership-verb risk did NOT fire (Jordan escapes)")

  const c02 = splitCase("02")
  const e02: any = await resolveResumeEvidence(c02.pt, { llm: { cache: frozen, allowLive: false } })
  console.log(`  [assert] case 02 degreeHeld === false (→ degree_or_waiver UNMET): ${e02.profileEvidence.degreeHeld === false}`)
  if (e02.profileEvidence.degreeHeld !== false) fails.push(`case 02 degreeHeld is ${JSON.stringify(e02.profileEvidence.degreeHeld)}, expected false`)

  // (b) full golden verdict run — the authority. 8/9, and 08 is the ONLY allowed miss.
  const run = spawnSync("python", ["validate.py", "--run"], { cwd: DIR, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } })
  const out = (run.stdout || "") + (run.stderr || "")
  const passLine = out.match(/(\d+)\/(\d+) cases pass/)
  const failing = [...out.matchAll(/^\[FAIL\] case (\d+)/gm)].map((m) => m[1])
  console.log(`  [golden] ${passLine ? passLine[0] : "NO PASS LINE FOUND"}; failing cases: [${failing.join(", ") || "none"}]`)
  if (!passLine || passLine[1] !== "8" || passLine[2] !== "9") fails.push(`golden set is ${passLine ? passLine[0] : "unparseable"}, expected 8/9`)
  const unexpected = failing.filter((c) => c !== "08")
  if (unexpected.length) fails.push(`unexpected golden failures beyond case 08: [${unexpected.join(", ")}]`)

  console.log(fails.length ? `\n✗ FREEZE REJECTED:\n  - ${fails.join("\n  - ")}` : "\n✓ FREEZE ACCEPTED (behavioral authority passed)")
  process.exit(fails.length ? 1 : 0)
}
main()
