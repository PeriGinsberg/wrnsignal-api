// Acceptance gate for the JobFit free-path fix (Ticket 1).
//
// Runs the frozen acceptance cases (real-world Jordan/Zurich + the suite) through
// the deterministic free-path engine and asserts target verdicts:
//   - false-positive cases MUST come down (Jordan->Pass, Catherine/J6->Pass,
//     Ava/J4 & Ava/J6 -> not Apply). RED until Ticket 1 Stages 1-2b land.
//   - true-fit cases MUST stay (Apply / not Pass). A true-fit failing = regression.
//
// Determinism: the live free-path runs a Haiku pre-pass (inferProfileOverridesFromResume)
// whose output we FREEZE to haiku-overrides.local.json on first run, so re-runs are
// reproducible yet faithful to the real funnel. targetFamilies is forced to [] and
// constraints/location zeroed, mirroring jobfit-run-trial-open.
//
// Inputs (fixtures.local.ts + haiku-overrides.local.json) are LOCAL-ONLY (real
// candidate PII the scorer reads — see README). This file + acceptance-baseline.json
// (outputs only) are committed. On a checkout without fixtures, the harness skips.
//
// Usage:
//   npx tsx tests/jobfit-regression/acceptance/acceptance-check.ts
//   npx tsx tests/jobfit-regression/acceptance/acceptance-check.ts --update-baseline

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

async function main() {
  for (const f of [".env.development.local", ".env.local"]) {
    let t = ""; try { t = readFileSync(f, "utf8") } catch { continue }
    for (const l of t.split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "") }
  }

  const HERE = __dirname
  const CACHE = join(HERE, "haiku-overrides.local.json")
  const BASELINE = join(HERE, "acceptance-baseline.json")

  let fixtures: any
  try { fixtures = await import("./fixtures.local") }
  catch { console.log("acceptance fixtures are local-only and absent — skipping (see tests/jobfit-regression/README.md)."); return 0 }
  const { RESUMES, JDS, CASES } = fixtures

  const { runJobFit } = await import("../../../app/api/_lib/jobfitEvaluator")
  const { inferProfileOverridesFromResume } = await import("../../../app/api/_lib/inferProfileOverridesFromResume")
  const { frozenSemanticOption } = await import("../lib/semantic-cache")
  const SEMANTIC = frozenSemanticOption()

  // Frozen Haiku overrides cache (one entry per résumé id).
  const cache: Record<string, any> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {}
  let dirty = false
  for (const rid of Object.keys(RESUMES)) {
    if (!(rid in cache)) { cache[rid] = await inferProfileOverridesFromResume(RESUMES[rid]); dirty = true }
  }
  if (dirty) writeFileSync(CACHE, JSON.stringify(cache, null, 2))

  const ZEROED = { hardNoSales:false,hardNoGovernment:false,hardNoContract:false,hardNoHourlyPay:false,hardNoFullyRemote:false,preferNotAnalyticsHeavy:false,hardNoContentOnly:false,hardNoPartTime:false,prefFullTime:false }
  const meets = (decision: string, t: any) =>
    t.atLeast === "Apply" ? (decision === "Apply" || decision === "Priority Apply") :
    t.decision ? decision === t.decision :
    t.notApply ? (decision !== "Apply" && decision !== "Priority Apply") :
    t.notPass ? decision !== "Pass" : false

  const results: any[] = []
  for (const c of CASES) {
    const ov = { ...(cache[c.resume] || {}), constraints: ZEROED, locationPreference: { mode: "unclear", constrained: false, allowedCities: [] }, targetFamilies: [] }
    const raw: any = await runJobFit({ profileText: "Resume:\n" + RESUMES[c.resume], jobText: JDS[c.jd], profileOverrides: ov, semantic: SEMANTIC })
    results.push({ id: c.id, kind: c.kind, target: c.target, decision: raw.decision, score: raw.score, met: meets(raw.decision, c.target) })
  }

  console.log("=== Acceptance gate (free-path, frozen Haiku) ===")
  for (const r of results) console.log(`  ${r.met ? "MEET" : "FAIL"}  ${r.id.padEnd(16)} ${String(r.decision).padEnd(14)} ${String(r.score).padStart(3)}  target=${JSON.stringify(r.target)} [${r.kind}]`)
  const fp = results.filter(r => r.kind === "false-positive"), tf = results.filter(r => r.kind === "true-fit")
  const fpFail = fp.filter(r => !r.met).length, tfFail = tf.filter(r => !r.met).length
  console.log(`\nfalse-positives fixed: ${fp.length - fpFail}/${fp.length}  |  true-fits preserved: ${tf.length - tfFail}/${tf.length}`)
  if (tfFail > 0) console.log(`*** ${tfFail} TRUE-FIT case(s) FAILING — that is a REGRESSION, not expected ***`)
  console.log(fpFail > 0
    ? `GATE: RED — ${fpFail} false-positive(s) still failing (EXPECTED pre-Ticket-1; flips green as Stages 1-2b land)`
    : `GATE: GREEN — all false-positives fixed`)

  if (process.argv.includes("--update-baseline")) {
    writeFileSync(BASELINE, JSON.stringify(results, null, 2) + "\n")
    console.log("\nWrote acceptance-baseline.json")
  }
  // Gate is RED (exit 1) if any false-positive unmet or any true-fit regressed.
  return (fpFail > 0 || tfFail > 0) ? 1 : 0
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(2) })
