#!/usr/bin/env tsx
// tests/jobfit-regression/shadow-jd-extract.ts
//
// Stage-1 JD-side SHADOW runner. For every JD across the 628 prod corpus + 68
// core cases (21 batch + 41 synthetic + 6 retest), runs BOTH extractors:
//   - regex extractJobSignals
//   - LLM extractJobSignalsLLM (Opus 4.8) — FREEZE-THEN-COMPARE
//
// FREEZE-THEN-COMPARE: the LLM result is written into the frozen extraction
// cache (jd-extraction.local.json). The first run is all live (builds the cache);
// every later run reads the frozen extraction (no re-call), so the agreement
// report measures LLM-vs-regex, never LLM-vs-its-own run wobble. The cache does
// double duty: determinism store + comparison baseline.
//
// NEVER calls scoreJobFit / runJobFit. Fail-open: LLM null on any error →
// coverage miss, regex untouched. Outputs (both extractions + jobText) go to
// shadow-jd.local.json (LOCAL-ONLY / gitignored). Nothing here is committed.
//
// USAGE:
//   NODE_OPTIONS=--use-system-ca npx tsx tests/jobfit-regression/shadow-jd-extract.ts
//   ...--limit 5        # first N JDs only (cost measurement)
//   ...--frozen-only    # allowLive:false — re-read cache, no live calls

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
;(process as any).loadEnvFile?.(join(process.cwd(), ".env.local"))

import { extractJobSignals } from "../../app/api/jobfit/extract"
import { extractJobSignalsLLM, type ExtractionCallMeta } from "../../app/api/jobfit/extractJobSignalsLLM"
import {
  loadExtractionCache,
  saveExtractionCache,
  EXTRACTION_MODEL,
  EXTRACTION_PROMPT_VERSION,
  type ExtractionResolveSource,
} from "../../app/api/jobfit/extractionCache"
import { parseCSV, CASE_OVERRIDES } from "./run-csv-in-process"
import { CASE as ryan013 } from "./retest-013-ryan"
import { CASE as ryan012 } from "./retest-012-ryan"
import { CASE as reece01 } from "./retest-reece-01"
import { CASE as case026 } from "./retest-026"
import { CASE as emma01 } from "./retest-emma-01"
import { CASE as zoeParalegal } from "./retest-zoe-paralegal"

const ROOT = join(__dirname, "..", "..")
const PROD_FIXTURE = join(__dirname, "prod-corpus.local.json")
const BATCH_CSV = join(ROOT, "issues", "040926ProdIssues.csv")
const SYNTHETIC_CSV = join(__dirname, "fixtures", "synthetic-cases-4102026.csv")
const CACHE_PATH = join(__dirname, "jd-extraction.local.json")
const SHADOW_OUT = join(__dirname, "shadow-jd.local.json")

// Opus 4.8 pricing (USD per token).
const OPUS_IN = 5 / 1_000_000
const OPUS_OUT = 25 / 1_000_000

type JD = { id: string; jobText: string; userJobTitle?: string }

function collectJDs(): JD[] {
  const out: JD[] = []

  // prod corpus (628) — has userJobTitle in the fixture
  if (existsSync(PROD_FIXTURE)) {
    const rows = JSON.parse(readFileSync(PROD_FIXTURE, "utf8")) as any[]
    for (const r of rows) {
      out.push({ id: `prod-${r.id}`, jobText: String(r.jobText || ""), userJobTitle: r.userJobTitle || undefined })
    }
  }

  // batch (21) — JD from the local CSV, title from CASE_OVERRIDES (gated)
  if (existsSync(BATCH_CSV)) {
    const rows = parseCSV(readFileSync(BATCH_CSV, "utf8"))
    const header = rows[0].map((h) => h.trim())
    const iNo = header.indexOf("Case Number")
    const iJob = header.indexOf("Job Description")
    for (const row of rows.slice(1)) {
      const caseNo = row[iNo]?.trim()
      const jobText = String(row[iJob] || "").trim()
      if (!caseNo || !jobText) continue
      out.push({ id: `batch-${caseNo}`, jobText, userJobTitle: CASE_OVERRIDES[caseNo]?.jobTitle || undefined })
    }
  }

  // synthetic (41) — JD from the committed CSV, no user title (matches harness)
  if (existsSync(SYNTHETIC_CSV)) {
    const rows = parseCSV(readFileSync(SYNTHETIC_CSV, "utf8"))
    const header = rows[0].map((h) => h.trim())
    const iNo = header.indexOf("Case Number")
    const iJob = header.indexOf("Job Description")
    for (const row of rows.slice(1)) {
      const caseNo = row[iNo]?.trim()
      const jobText = String(row[iJob] || "").trim()
      if (!caseNo || !jobText) continue
      out.push({ id: `synthetic-${caseNo}`, jobText })
    }
  }

  // retests (6) — CASE constants
  for (const c of [ryan013, ryan012, reece01, case026, emma01, zoeParalegal]) {
    out.push({ id: c.id, jobText: c.jobText, userJobTitle: c.userJobTitle })
  }

  return out
}

// Reduce a regex StructuredJobSignals to the comparable shadow shape.
function regexShadow(jobText: string, title?: string) {
  const rx: any = extractJobSignals(jobText, { userJobTitle: title })
  return {
    requirement_units: (rx.requirement_units || []).map((u: any) => ({
      key: u.key, kind: u.kind, requiredness: u.requiredness, strength: u.strength, functionTag: u.functionTag ?? null,
    })),
    scalars: {
      jobFamily: rx.jobFamily, financeSubFamily: rx.financeSubFamily, salesSubFamily: rx.salesSubFamily,
      jobArchetype: rx.jobArchetype, jobIndustry: rx.jobIndustry, detectedDomain: rx.detectedDomain,
      analytics: { isHeavy: rx.analytics?.isHeavy ?? false },
      location: { mode: rx.location?.mode, city: rx.location?.city ?? null },
      yearsRequired: rx.yearsRequired, gradYearHint: rx.gradYearHint,
      isGovernment: rx.isGovernment, isSalesHeavy: rx.isSalesHeavy, isContract: rx.isContract, isHourly: rx.isHourly,
      isPartTime: rx.isPartTime ?? null, // regex never sets it → null (dead-gate finding)
      isSeniorRole: rx.isSeniorRole, isTrainingProgram: rx.isTrainingProgram, isContentExecutionHeavy: rx.isContentExecutionHeavy,
      mbaRequired: rx.mbaRequired, bachelorRequired: rx.bachelorRequired,
      credentialRequired: rx.credentialRequired, credentialDetail: rx.credentialDetail, credentialSponsored: rx.credentialSponsored,
      requiresAdvisoryBackground: rx.requiresAdvisoryBackground, requiresFinancialModeling: rx.requiresFinancialModeling,
      requiresDomainIndustryExperience: rx.requiresDomainIndustryExperience,
      requiresSoftCredential: rx.requiresSoftCredential, softCredentialDetail: rx.softCredentialDetail,
      mentionsPharmaTraining: rx.mentionsPharmaTraining ?? false, territoryUndisclosed: rx.territoryUndisclosed ?? false,
      requiredTools: rx.requiredTools || [], preferredTools: rx.preferredTools || [], function_tags: rx.function_tags || [],
    },
  }
}

async function main() {
  const args = process.argv.slice(2)
  const limitArg = args.indexOf("--limit")
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity
  const frozenOnly = args.includes("--frozen-only")
  const allowLive = !frozenOnly

  const cache = loadExtractionCache(CACHE_PATH)
  const jds = collectJDs().slice(0, limit)
  console.log(
    `[shadow] ${jds.length} JDs | model=${EXTRACTION_MODEL} prompt=${EXTRACTION_PROMPT_VERSION} | ` +
      `allowLive=${allowLive} | cache has ${Object.keys(cache).length} entries`
  )

  const shadow: Record<string, unknown> = {}
  let live = 0, hits = 0, misses = 0, errors = 0
  let totalIn = 0, totalOut = 0, totalMs = 0
  const t0 = Date.now()

  for (let i = 0; i < jds.length; i++) {
    const jd = jds[i]
    let source: ExtractionResolveSource = "miss"
    const llm = await extractJobSignalsLLM(jd.jobText, {
      userJobTitle: jd.userJobTitle,
      cache,
      allowLive,
      onResolve: (info) => { source = info.source },
      onMeta: (m: ExtractionCallMeta) => { totalIn += m.input_tokens; totalOut += m.output_tokens; totalMs += m.latency_ms },
    })
    if (source === "live") live++
    else if (source === "cache") hits++
    if (!llm) { if (source === "error") errors++; else misses++ }

    shadow[jd.id] = {
      id: jd.id,
      userJobTitle: jd.userJobTitle ?? null,
      jobText: jd.jobText, // local-only file; needed for the appendix grounding
      regex: regexShadow(jd.jobText, jd.userJobTitle),
      llm, // full LLM extraction (or null on fail-open)
      llm_source: source,
    }

    if ((i + 1) % 25 === 0 || i === jds.length - 1) {
      const cost = totalIn * OPUS_IN + totalOut * OPUS_OUT
      console.log(
        `[shadow] ${i + 1}/${jds.length} | live=${live} cache=${hits} miss=${misses} err=${errors} | ` +
          `tok in=${totalIn} out=${totalOut} | $${cost.toFixed(2)} | ${((Date.now() - t0) / 1000).toFixed(0)}s`
      )
      saveExtractionCache(CACHE_PATH, cache) // checkpoint so a crash resumes from cache
    }
  }

  saveExtractionCache(CACHE_PATH, cache)
  // shadow-jd.local.json is local-only (*.local.json gitignored).
  const fs = await import("node:fs")
  fs.writeFileSync(SHADOW_OUT, JSON.stringify(shadow, null, 2) + "\n", "utf8")

  const cost = totalIn * OPUS_IN + totalOut * OPUS_OUT
  const liveCost = live > 0 ? cost / live : 0
  console.log(`\n[shadow] DONE ${jds.length} JDs in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  console.log(`  live=${live} cache=${hits} miss=${misses} err=${errors}`)
  console.log(`  tokens: in=${totalIn} out=${totalOut} (out includes adaptive-thinking)`)
  console.log(`  cost: $${cost.toFixed(2)} total | $${liveCost.toFixed(4)}/live-call avg`)
  console.log(`  wrote cache → ${CACHE_PATH}`)
  console.log(`  wrote shadow outputs → ${SHADOW_OUT} (local-only)`)
  if (live > 0) {
    const per = { in: Math.round(totalIn / live), out: Math.round(totalOut / live), ms: Math.round(totalMs / live) }
    console.log(`  per-live-call avg: in=${per.in} out=${per.out} tok, ${(per.ms / 1000).toFixed(1)}s`)
    console.log(`  → projection for 696 JDs: $${(liveCost * 696).toFixed(2)}, ~${((per.ms * 696) / 1000 / 60).toFixed(0)} min sequential`)
  }
}

main().catch((e) => { console.error("[shadow] fatal:", e); process.exit(1) })
