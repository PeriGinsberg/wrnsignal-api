#!/usr/bin/env tsx
// Stage 2 — freeze semantic relevance verdicts for the 68-case + acceptance
// corpus. Builds matches, runs the suspect gate, calls Haiku live (temp 0) for
// each distinct (requirement, evidence) suspect pair, and writes the frozen
// verdict cache. Re-runnable: cached keys are not re-called.
//
//   npx tsx tests/jobfit-regression/freeze-semantic-verdicts.ts          # freeze + report
//   npx tsx tests/jobfit-regression/freeze-semantic-verdicts.ts --report # report only (no live)

import { join } from "node:path"
import { readFileSync, existsSync, writeFileSync } from "node:fs"
import { runBatch } from "./run-csv-in-process"
import { runJobFit } from "../../app/api/_lib/jobfitEvaluator"
import { mapClientProfileToOverrides } from "../../app/api/_lib/jobfitProfileAdapter"
import { buildEvidenceMatches } from "../../app/api/jobfit/scoring"
import { suspectMatches, type GateMatch } from "../../app/api/jobfit/semanticGate"
import { getVerdict, verdictKey, type VerdictCache } from "../../app/api/jobfit/semanticRelevance"
import { CASE as ryan013 } from "./retest-013-ryan"
import { CASE as ryan012 } from "./retest-012-ryan"
import { CASE as reece01 } from "./retest-reece-01"
import { CASE as case026 } from "./retest-026"
import { CASE as emma01 } from "./retest-emma-01"
import { CASE as zoe } from "./retest-zoe-paralegal"

const CACHE_PATH = join(process.cwd(), "tests/jobfit-regression/semantic-verdicts.local.json")
const ALLOW_LIVE = !process.argv.includes("--report")

type SuspectCall = { jobContext: string; requirement: string; evidence: string; pk: string; jk: string; strength: string }

function jobContext(job: any): string {
  const parts: string[] = []
  if (job.jobTitle) parts.push(String(job.jobTitle))
  parts.push(String(job.jobFamily))
  if (job.financeSubFamily) parts.push(`finance:${job.financeSubFamily}`)
  return parts.join(" — ")
}

function suspectCalls(result: any): SuspectCall[] {
  const job = result.job_signals, profile = result.profile_signals
  const ms = buildEvidenceMatches(job, profile)
  const gm: GateMatch[] = ms.map((m: any) => ({ job_unit_key: m.job_unit.key, profile_unit_key: m.profile_unit.key, match_strength: m.match_strength, weight: m.weight, job_fact: m.job_fact }))
  const susKeys = new Set(suspectMatches(gm, job).map((s) => `${s.profile_unit_key}|${s.job_unit_key}|${s.match_strength}`))
  const ctx = jobContext(job)
  const seen = new Set<string>()
  const out: SuspectCall[] = []
  for (const m of ms) {
    const sk = `${m.profile_unit.key}|${m.job_unit.key}|${m.match_strength}`
    if (!susKeys.has(sk)) continue
    const requirement = String(m.job_fact || ""), evidence = String(m.profile_fact || "")
    if (!requirement || !evidence) continue
    const k = verdictKey(requirement, evidence)
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ jobContext: ctx, requirement, evidence, pk: m.profile_unit.key, jk: m.job_unit.key, strength: m.match_strength })
  }
  return out
}

async function runInline(c: any) {
  let arr: any
  try { arr = JSON.parse(c.profileJson) } catch {
    let d = 0, e = -1
    for (let k = 0; k < c.profileJson.length; k++) { const ch = c.profileJson[k]; if (ch === "[") d++; else if (ch === "]") { d--; if (d === 0) { e = k; break } } }
    arr = JSON.parse(c.profileJson.slice(0, e + 1))
  }
  const p = Array.isArray(arr) ? arr[0] : arr
  const profileText = (String(p.profile_text || "").trim() + "\n\nResume:\n" + String(p.resume_text || "").trim()).trim()
  const ov = mapClientProfileToOverrides({ profileText, profileStructured: typeof p.profile_structured === "string" ? JSON.parse(p.profile_structured || "null") : p.profile_structured, targetRoles: p.target_roles || null, preferredLocations: p.preferred_locations || p.target_locations || null })
  return runJobFit({ profileText, jobText: c.jobText, profileOverrides: ov, userJobTitle: c.userJobTitle, userCompanyName: c.userCompanyName } as any)
}

async function main() {
  for (const f of [".env.development.local", ".env.local"]) {
    let t = ""; try { t = readFileSync(f, "utf8") } catch { continue }
    for (const l of t.split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "") }
  }

  const cache: VerdictCache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {}
  const before = Object.keys(cache).length

  // Collect every case + its suspect calls.
  const cases: Array<{ id: string; kind: string; result: any; calls: SuspectCall[] }> = []
  const issues = join(process.cwd(), "issues", "040926ProdIssues.csv")
  const synth = join(process.cwd(), "tests/jobfit-regression/fixtures/synthetic-cases-4102026.csv")
  for (const c of [...(await runBatch(issues)), ...(await runBatch(synth))]) cases.push({ id: c.caseNo, kind: "synthetic", result: c.result, calls: suspectCalls(c.result) })
  for (const c of [ryan013, ryan012, reece01, case026, emma01, zoe]) { const r = await runInline(c); cases.push({ id: c.id || "retest", kind: "retest", result: r, calls: suspectCalls(r) }) }

  // Acceptance fixtures (local-only).
  try {
    const fx: any = await import("./acceptance/fixtures.local")
    const HC = join(process.cwd(), "tests/jobfit-regression/acceptance/haiku-overrides.local.json")
    const hcache: any = existsSync(HC) ? JSON.parse(readFileSync(HC, "utf8")) : {}
    const Z = { hardNoSales: false, hardNoGovernment: false, hardNoContract: false, hardNoHourlyPay: false, hardNoFullyRemote: false, preferNotAnalyticsHeavy: false, hardNoContentOnly: false, hardNoPartTime: false, prefFullTime: false }
    for (const c of fx.CASES) {
      const ov = { ...(hcache[c.resume] || {}), constraints: Z, locationPreference: { mode: "unclear", constrained: false, allowedCities: [] }, targetFamilies: [] }
      const r: any = await runJobFit({ profileText: "Resume:\n" + fx.RESUMES[c.resume], jobText: fx.JDS[c.jd], profileOverrides: ov })
      cases.push({ id: c.id, kind: c.kind, result: r, calls: suspectCalls(r) })
    }
  } catch { console.log("(acceptance fixtures absent — skipping)") }

  // Freeze: call live for any uncached pair.
  const allCalls = cases.flatMap((c) => c.calls)
  const distinct = new Map<string, SuspectCall>()
  for (const c of allCalls) distinct.set(verdictKey(c.requirement, c.evidence), c)
  console.log(`Cases: ${cases.length} | distinct suspect pairs: ${distinct.size} | cached before: ${before} | live=${ALLOW_LIVE}`)
  let called = 0
  for (const c of distinct.values()) {
    const had = !!cache[verdictKey(c.requirement, c.evidence)]
    await getVerdict(cache, c, { allowLive: ALLOW_LIVE })
    if (!had && ALLOW_LIVE) called++
  }
  if (ALLOW_LIVE) writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2))
  console.log(`Live calls made: ${called} | cache now: ${Object.keys(cache).length}\n`)

  // Report.
  const show = (c: { id: string; kind: string; calls: SuspectCall[] }) => {
    if (!c.calls.length) return
    console.log(`\n${c.id}  [${c.kind}]`)
    for (const call of c.calls) {
      const v = cache[verdictKey(call.requirement, call.evidence)]
      const flag = v && v.satisfies === false && v.confidence === "high" ? "  → SUPPRESS" : "  → keep"
      console.log(`  ${call.pk} → ${call.jk} (${call.strength})  satisfies=${v?.satisfies} conf=${v?.confidence}${flag}`)
      console.log(`     req: «${call.requirement.slice(0, 100)}»`)
      console.log(`     ev:  «${call.evidence.slice(0, 100)}»`)
      console.log(`     reason: ${v?.reason}`)
    }
  }

  console.log("════════ RESIDUALS (must suppress) ════════")
  for (const id of ["jordan-zurich", "ava-j4", "ava-j6"]) { const c = cases.find((x) => x.id === id); if (c) show(c) }

  console.log("\n════════ SAMPLE SYNTHETIC FLAGS ════════")
  const synthFlagged = cases.filter((c) => c.kind === "synthetic" && c.calls.length)
  for (const c of synthFlagged.slice(0, 6)) show(c)

  console.log("\n════════ SANITY: any TRUE-FIT / guard with suppressions? ════════")
  for (const c of cases.filter((x) => x.kind === "true-fit" || x.id.startsWith("retest"))) {
    const sup = c.calls.filter((call) => { const v = cache[verdictKey(call.requirement, call.evidence)]; return v && v.satisfies === false && v.confidence === "high" })
    if (sup.length) console.log(`  !! ${c.id} has ${sup.length} suppression(s)`)
  }
  console.log("  (none printed above = clean)")
}
main().catch((e) => { console.error(e); process.exit(1) })
