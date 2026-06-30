#!/usr/bin/env tsx
// tests/jobfit-regression/shadow-agreement-report.ts
//
// Stage-1 JD-side agreement report. Reads shadow-jd.local.json (regex + frozen
// LLM per JD) and produces:
//   - COMMITTED aggregate-only report (shadow-agreement-report.json + .md) — NO
//     raw JD/resume text. Unit metrics + stable-scalar table + judgment section
//     + jobFamily confusion matrix.
//   - LOCAL-ONLY appendix (shadow-appendix.local.json) — 30 sampled canonical_key
//     disagreements + all "other" units, WITH verbatim requirement_text spans for
//     human eyeball. Not committed.
//
// Scalar split (approved): STABLE = headline; JUDGMENT = soft/sampled, excluded
// from the headline. requiresFinancialModeling is JUDGMENT (comprehension call).

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const DIR = __dirname
const SHADOW_OUT = join(DIR, "shadow-jd.local.json")
const REPORT_JSON = join(DIR, "shadow-agreement-report.json")
const REPORT_MD = join(DIR, "shadow-agreement-report.md")
const APPENDIX_LOCAL = join(DIR, "shadow-appendix.local.json")

// ── Scalar classification ─────────────────────────────────────────────────────
const STABLE_BOOL = [
  "mbaRequired", "bachelorRequired", "credentialRequired", "credentialSponsored",
  "isContract", "isHourly", "isGovernment", "isTrainingProgram", "isSalesHeavy",
  "mentionsPharmaTraining", "territoryUndisclosed", "requiresAdvisoryBackground", "requiresSoftCredential",
  "location.constrained",
]
const STABLE_NUM = ["yearsRequired", "gradYearHint"] // ±1
const STABLE_ENUM = ["location.mode"]
const STABLE_PRESENCE = ["credentialDetail", "softCredentialDetail", "location.city"]

const JUDGMENT_BOOL = [
  "isSeniorRole", "requiresDomainIndustryExperience", "isContentExecutionHeavy",
  "requiresFinancialModeling", "analytics.isHeavy",
]
const JUDGMENT_ENUM = ["jobFamily", "financeSubFamily", "salesSubFamily", "jobArchetype"]
const JUDGMENT_VALUE = ["jobIndustry", "detectedDomain"] // presence in headline-adjacent; value here

const NUM_BAND = 1

// ── Helpers ───────────────────────────────────────────────────────────────────
function get(o: any, path: string): any {
  return path.split(".").reduce((a, k) => (a == null ? a : a[k]), o)
}
function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`
}
const lc = (s: any) => String(s ?? "").trim().toLowerCase()

// COMPARATOR-ONLY tool-name canonicalizer. Normalizes vendor prefixes (Microsoft
// Azure↔azure), .js/version suffixes (node.js↔node), and common abbreviations
// (gcp↔google cloud, js↔javascript) so regex and LLM tool mentions match on the
// same form. Does NOT touch the extractor or the frozen cache — this only affects
// how agreement is MEASURED. Capability keys are NOT canonicalized (already a
// shared vocabulary); only kind:"tool" / canonical_key:"tool" names pass through.
const TOOL_ALIASES: Record<string, string> = {
  "microsoft azure": "azure", "ms azure": "azure", azure: "azure",
  "google cloud": "gcp", "google cloud platform": "gcp", gcp: "gcp",
  "amazon web services": "aws", aws: "aws",
  "node.js": "node", nodejs: "node", node: "node",
  javascript: "javascript", js: "javascript",
  "microsoft excel": "excel", "ms excel": "excel", excel: "excel",
  "microsoft word": "word", word: "word",
  "microsoft powerpoint": "powerpoint", "power point": "powerpoint", powerpoint: "powerpoint",
  "microsoft power bi": "power bi", powerbi: "power bi", "power bi": "power bi",
  "adobe photoshop": "photoshop", photoshop: "photoshop",
  "adobe illustrator": "illustrator", illustrator: "illustrator",
  "adobe indesign": "indesign", indesign: "indesign",
  "c#": "c#", csharp: "c#", "c sharp": "c#",
  "c++": "c++", cpp: "c++",
  "google sheets": "google sheets", sheets: "google sheets",
  "google docs": "google docs",
  "google analytics": "google analytics", ga4: "google analytics", ga: "google analytics",
  salesforce: "salesforce", sfdc: "salesforce",
  html: "html", html5: "html", css: "css", css3: "css",
  react: "react", "react.js": "react", reactjs: "react",
  vue: "vue", "vue.js": "vue", vuejs: "vue",
  angular: "angular", "angular.js": "angular", angularjs: "angular",
  postgresql: "postgres", postgres: "postgres",
  kubernetes: "kubernetes", k8s: "kubernetes",
  golang: "go", go: "go",
}
function canonicalTool(name: any): string {
  let t = lc(name)
  if (TOOL_ALIASES[t]) return TOOL_ALIASES[t]
  // light normalization for unmapped names, then re-check the map
  t = t.replace(/\.js$/, "").replace(/\s+v?\d+(\.\d+)*$/, "").trim()
  t = t.replace(/^(microsoft|ms|adobe|amazon)\s+/, "").trim()
  return TOOL_ALIASES[t] || t
}

// Regex unit key in the comparable space (tool units → canonical tool name; else capability key).
function regexComparableKey(u: any): string {
  return u.kind === "tool" ? canonicalTool(u.key) : lc(u.key)
}
// LLM unit in the comparable space; "other" → null (excluded from matchable set).
function llmComparableKey(u: any): string | null {
  if (u.canonical_key === "other") return null
  if (u.canonical_key === "tool") return canonicalTool(u.tool_name)
  return lc(u.canonical_key)
}

function main() {
  if (!existsSync(SHADOW_OUT)) {
    console.error(`Missing ${SHADOW_OUT} — run shadow-jd-extract.ts first.`)
    process.exit(1)
  }
  const shadow = JSON.parse(readFileSync(SHADOW_OUT, "utf8")) as Record<string, any>
  const all = Object.values(shadow)
  const withLLM = all.filter((r) => r.llm)
  const coverage = {
    total: all.length,
    withLLM: withLLM.length,
    nullLLM: all.length - withLLM.length,
    bySource: all.reduce((m: any, r) => ((m[r.llm_source] = (m[r.llm_source] || 0) + 1), m), {}),
  }

  // ── UNIT metrics ────────────────────────────────────────────────────────────
  let interSum = 0, llmDenom = 0, regexDenom = 0, unionSum = 0
  const macroP: number[] = [], macroR: number[] = [], macroJ: number[] = []
  const countDeltas: number[] = []
  let llmGtRegex = 0, llmUnitsTotal = 0, regexUnitsTotal = 0, otherTotal = 0
  const otherLabels: Record<string, number> = {}
  const regexKindDist: Record<string, number> = {}, llmKindDist: Record<string, number> = {}
  // matched-key intersection: requiredness + strength agreement
  let matchedPairs = 0, reqnessAgree = 0, strengthWithin2 = 0
  const disagreements: any[] = []
  const otherUnits: any[] = []

  for (const r of withLLM) {
    const rxUnits = r.regex.requirement_units || []
    const llmUnits = r.llm.requirement_units || []
    regexUnitsTotal += rxUnits.length
    llmUnitsTotal += llmUnits.length
    countDeltas.push(llmUnits.length - rxUnits.length)
    if (llmUnits.length > rxUnits.length) llmGtRegex++

    for (const u of rxUnits) regexKindDist[u.kind] = (regexKindDist[u.kind] || 0) + 1
    for (const u of llmUnits) {
      llmKindDist[u.kind] = (llmKindDist[u.kind] || 0) + 1
      if (u.canonical_key === "other") {
        otherTotal++
        const lab = lc(u.label)
        otherLabels[lab] = (otherLabels[lab] || 0) + 1
        otherUnits.push({ id: r.id, label: u.label, kind: u.kind, requirement_text: u.requirement_text })
      }
    }

    const rxSet = new Set(rxUnits.map(regexComparableKey).filter(Boolean))
    const llmKeyByUnit = new Map<string, any>()
    for (const u of llmUnits) {
      const k = llmComparableKey(u)
      if (k) llmKeyByUnit.set(k, u)
    }
    const llmSet = new Set(llmKeyByUnit.keys())
    const inter = [...llmSet].filter((k) => rxSet.has(k))
    const union = new Set([...rxSet, ...llmSet])
    interSum += inter.length
    llmDenom += llmSet.size
    regexDenom += rxSet.size
    unionSum += union.size
    if (llmSet.size) macroP.push(inter.length / llmSet.size)
    if (rxSet.size) macroR.push(inter.length / rxSet.size)
    if (union.size) macroJ.push(inter.length / union.size)

    // matched-key requiredness + strength agreement
    const rxByKey = new Map<string, any>()
    for (const u of rxUnits) rxByKey.set(regexComparableKey(u), u)
    for (const k of inter) {
      const ru = rxByKey.get(k), lu = llmKeyByUnit.get(k)
      if (!ru || !lu) continue
      matchedPairs++
      if (ru.requiredness === lu.requiredness) reqnessAgree++
      if (Math.abs(Number(ru.strength) - Number(lu.strength)) <= 2) strengthWithin2++
    }

    // collect disagreements for the appendix (llm-only + regex-only keys)
    for (const k of llmSet) if (!rxSet.has(k)) disagreements.push({ id: r.id, key: k, side: "llm-only", requirement_text: llmKeyByUnit.get(k)?.requirement_text || "" })
    for (const k of rxSet) if (!llmSet.has(k)) disagreements.push({ id: r.id, key: k, side: "regex-only", requirement_text: "" })
  }

  countDeltas.sort((a, b) => a - b)
  const median = (xs: number[]) => (xs.length ? xs[Math.floor(xs.length / 2)] : 0)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

  const units = {
    micro: { precision: pct(interSum, llmDenom), recall: pct(interSum, regexDenom), jaccard: pct(interSum, unionSum) },
    macro: { precision: pct(mean(macroP) * macroP.length, macroP.length), recall: pct(mean(macroR) * macroR.length, macroR.length), jaccard: pct(mean(macroJ) * macroJ.length, macroJ.length) },
    otherRate: pct(otherTotal, llmUnitsTotal),
    otherTotal,
    otherLabelHistogram: Object.entries(otherLabels).sort((a, b) => b[1] - a[1]).slice(0, 25),
    countDelta: {
      meanLlmMinusRegex: mean(countDeltas).toFixed(2),
      median: median(countDeltas),
      min: countDeltas[0], max: countDeltas[countDeltas.length - 1],
      pctJDsLlmGtRegex: pct(llmGtRegex, withLLM.length),
      regexUnitsTotal, llmUnitsTotal,
    },
    kindDistribution: { regex: regexKindDist, llm: llmKindDist },
    matchedKeyIntersection: {
      pairs: matchedPairs,
      requirednessAgree: pct(reqnessAgree, matchedPairs),
      strengthWithin2: pct(strengthWithin2, matchedPairs),
    },
  }

  // ── SCALAR agreement ─────────────────────────────────────────────────────────
  function boolAgree(scalars: string[]) {
    const out: any = {}
    for (const s of scalars) {
      let agree = 0, rxTrueLlmFalse = 0, rxFalseLlmTrue = 0, n = 0
      for (const r of withLLM) {
        const rv = get(r.regex.scalars, s), lv = get(r.llm.scalars, s)
        if (rv == null && s === "isPartTime") continue
        n++
        if (Boolean(rv) === Boolean(lv)) agree++
        else if (rv && !lv) rxTrueLlmFalse++
        else rxFalseLlmTrue++
      }
      out[s] = { agree: pct(agree, n), n, dir: { regexTrue_llmFalse: rxTrueLlmFalse, regexFalse_llmTrue: rxFalseLlmTrue } }
    }
    return out
  }
  function numAgree(scalars: string[]) {
    const out: any = {}
    for (const s of scalars) {
      let agree = 0, n = 0
      for (const r of withLLM) {
        const rv = get(r.regex.scalars, s), lv = get(r.llm.scalars, s)
        n++
        if (rv == null && lv == null) agree++
        else if (rv != null && lv != null && Math.abs(Number(rv) - Number(lv)) <= NUM_BAND) agree++
      }
      out[s] = { agreeWithinBand: pct(agree, n), band: NUM_BAND, n }
    }
    return out
  }
  function enumAgree(scalars: string[]) {
    const out: any = {}
    for (const s of scalars) {
      let agree = 0, n = 0
      for (const r of withLLM) {
        const rv = get(r.regex.scalars, s), lv = get(r.llm.scalars, s)
        n++
        if (lc(rv) === lc(lv)) agree++
      }
      out[s] = { agree: pct(agree, n), n }
    }
    return out
  }
  function presenceAgree(scalars: string[]) {
    const out: any = {}
    for (const s of scalars) {
      let agree = 0, n = 0
      for (const r of withLLM) {
        const rh = get(r.regex.scalars, s) != null && lc(get(r.regex.scalars, s)) !== ""
        const lh = get(r.llm.scalars, s) != null && lc(get(r.llm.scalars, s)) !== ""
        n++
        if (rh === lh) agree++
      }
      out[s] = { presenceAgree: pct(agree, n), n }
    }
    return out
  }

  // tool-set (combined required ∪ preferred), micro Jaccard + P/R
  let tInter = 0, tRx = 0, tLlm = 0, tUnion = 0
  for (const r of withLLM) {
    const rxT = new Set([...(r.regex.scalars.requiredTools || []), ...(r.regex.scalars.preferredTools || [])].map(canonicalTool))
    const llmT = new Set([...(r.llm.scalars.requiredTools || []), ...(r.llm.scalars.preferredTools || [])].map(canonicalTool))
    const inter = [...llmT].filter((x) => rxT.has(x))
    tInter += inter.length; tRx += rxT.size; tLlm += llmT.size; tUnion += new Set([...rxT, ...llmT]).size
  }

  // isPartTime special — regex never sets it (dead-gate finding)
  let llmPartTime = 0
  for (const r of withLLM) if (r.llm.scalars.isPartTime === true) llmPartTime++

  const stableScalars = {
    bool: boolAgree(STABLE_BOOL),
    numeric: numAgree(STABLE_NUM),
    enum: enumAgree(STABLE_ENUM),
    presence: presenceAgree(STABLE_PRESENCE),
    toolSet: { jaccard: pct(tInter, tUnion), precision: pct(tInter, tLlm), recall: pct(tInter, tRx) },
    isPartTime_LLMonly: { llmFlaggedPartTime: llmPartTime, of: withLLM.length, note: "regex never emits isPartTime (dead gate) — LLM-only signal, no agreement baseline" },
  }

  const judgmentScalars = {
    note: "SOFT / directional — one frozen sample per JD; classification/threshold calls wobble. EXCLUDED from headline.",
    bool: boolAgree(JUDGMENT_BOOL),
    enum: enumAgree(JUDGMENT_ENUM),
    value_presence: presenceAgree(JUDGMENT_VALUE),
  }

  // jobFamily confusion matrix
  const fam: Record<string, Record<string, number>> = {}
  for (const r of withLLM) {
    const rf = String(r.regex.scalars.jobFamily || "?"), lf = String(r.llm.scalars.jobFamily || "?")
    ;(fam[rf] ||= {})[lf] = (fam[rf]?.[lf] || 0) + 1
  }

  // headline stable agreement = mean of stable scalar agree-rates (parse %s back)
  const stableRates: number[] = []
  const pull = (o: any, k: string) => parseFloat(String(o[k]).replace("%", "")) || (String(o[k]) === "n/a" ? NaN : 0)
  for (const s of STABLE_BOOL) stableRates.push(pull(stableScalars.bool[s], "agree"))
  for (const s of STABLE_NUM) stableRates.push(pull(stableScalars.numeric[s], "agreeWithinBand"))
  for (const s of STABLE_ENUM) stableRates.push(pull(stableScalars.enum[s], "agree"))
  for (const s of STABLE_PRESENCE) stableRates.push(pull(stableScalars.presence[s], "presenceAgree"))
  stableRates.push(parseFloat(stableScalars.toolSet.jaccard))
  const headlineStable = (stableRates.filter((x) => !isNaN(x)).reduce((a, b) => a + b, 0) / stableRates.filter((x) => !isNaN(x)).length).toFixed(1) + "%"

  const report = {
    generated_from: "shadow-jd.local.json",
    coverage,
    headline: { stableScalarMeanAgree: headlineStable, unitKeyMicro: units.micro },
    units,
    stableScalars,
    judgmentScalars,
    jobFamilyConfusion: fam,
  }

  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + "\n", "utf8")
  writeFileSync(REPORT_MD, renderMarkdown(report), "utf8")

  // ── LOCAL appendix (verbatim spans — NOT committed) ──────────────────────────
  const step = Math.max(1, Math.floor(disagreements.length / 30))
  const sampled = disagreements.filter((_, i) => i % step === 0).slice(0, 30)
  writeFileSync(APPENDIX_LOCAL, JSON.stringify({ sampledDisagreements: sampled, otherUnits }, null, 2) + "\n", "utf8")

  // ── Console summary ──────────────────────────────────────────────────────────
  console.log(`coverage: ${coverage.withLLM}/${coverage.total} with LLM | null=${coverage.nullLLM} | sources=${JSON.stringify(coverage.bySource)}`)
  console.log(`UNIT micro: precision=${units.micro.precision} recall=${units.micro.recall} jaccard=${units.micro.jaccard}`)
  console.log(`  other-rate=${units.otherRate} (${otherTotal} units) | count-delta mean(llm-regex)=${units.countDelta.meanLlmMinusRegex} median=${units.countDelta.median} | %JDs llm>regex=${units.countDelta.pctJDsLlmGtRegex}`)
  console.log(`  matched-key: requiredness=${units.matchedKeyIntersection.requirednessAgree} strength±2=${units.matchedKeyIntersection.strengthWithin2} (${matchedPairs} pairs)`)
  console.log(`STABLE headline mean agree: ${headlineStable}`)
  console.log(`wrote ${REPORT_JSON}, ${REPORT_MD}, ${APPENDIX_LOCAL} (appendix local-only)`)
}

function renderMarkdown(r: any): string {
  const L: string[] = []
  L.push(`# Stage 1 JD-side shadow agreement report`, ``)
  L.push(`Coverage: ${r.coverage.withLLM}/${r.coverage.total} JDs with LLM extraction (null=${r.coverage.nullLLM}; sources ${JSON.stringify(r.coverage.bySource)})`, ``)
  L.push(`## Headline`, `- Unit key (micro): precision ${r.units.micro.precision}, recall ${r.units.micro.recall}, Jaccard ${r.units.micro.jaccard}`)
  L.push(`- Stable-scalar mean agreement: ${r.headline.stableScalarMeanAgree}`, ``)
  L.push(`## Units`)
  L.push(`- macro: P ${r.units.macro.precision} / R ${r.units.macro.recall} / J ${r.units.macro.jaccard}`)
  L.push(`- "other"-rate: ${r.units.otherRate} (${r.units.otherTotal} units)`)
  L.push(`- count delta (llm−regex): mean ${r.units.countDelta.meanLlmMinusRegex}, median ${r.units.countDelta.median}, range [${r.units.countDelta.min},${r.units.countDelta.max}]; %JDs llm>regex ${r.units.countDelta.pctJDsLlmGtRegex}`)
  L.push(`- matched-key: requiredness ${r.units.matchedKeyIntersection.requirednessAgree}, strength±2 ${r.units.matchedKeyIntersection.strengthWithin2} (${r.units.matchedKeyIntersection.pairs} pairs)`)
  L.push(`- kind distribution regex=${JSON.stringify(r.units.kindDistribution.regex)} llm=${JSON.stringify(r.units.kindDistribution.llm)}`, ``)
  L.push(`### "other" label histogram (top)`)
  for (const [lab, n] of r.units.otherLabelHistogram) L.push(`- ${n}× ${lab}`)
  L.push(``, `## Stable scalars (headline)`)
  for (const s of Object.keys(r.stableScalars.bool)) L.push(`- ${s}: ${r.stableScalars.bool[s].agree} (n=${r.stableScalars.bool[s].n}; rxTrue/llmFalse=${r.stableScalars.bool[s].dir.regexTrue_llmFalse}, rxFalse/llmTrue=${r.stableScalars.bool[s].dir.regexFalse_llmTrue})`)
  for (const s of Object.keys(r.stableScalars.numeric)) L.push(`- ${s}: ${r.stableScalars.numeric[s].agreeWithinBand} (±${r.stableScalars.numeric[s].band})`)
  for (const s of Object.keys(r.stableScalars.enum)) L.push(`- ${s}: ${r.stableScalars.enum[s].agree}`)
  for (const s of Object.keys(r.stableScalars.presence)) L.push(`- ${s}: ${r.stableScalars.presence[s].presenceAgree} (presence)`)
  L.push(`- toolSet: Jaccard ${r.stableScalars.toolSet.jaccard}, P ${r.stableScalars.toolSet.precision}, R ${r.stableScalars.toolSet.recall}`)
  L.push(`- isPartTime: ${r.stableScalars.isPartTime_LLMonly.llmFlaggedPartTime}/${r.stableScalars.isPartTime_LLMonly.of} LLM-flagged (regex unset — dead gate)`, ``)
  L.push(`## Judgment scalars (SOFT — directional, excluded from headline)`)
  for (const s of Object.keys(r.judgmentScalars.bool)) L.push(`- ${s}: ${r.judgmentScalars.bool[s].agree} (rxTrue/llmFalse=${r.judgmentScalars.bool[s].dir.regexTrue_llmFalse}, rxFalse/llmTrue=${r.judgmentScalars.bool[s].dir.regexFalse_llmTrue})`)
  for (const s of Object.keys(r.judgmentScalars.enum)) L.push(`- ${s}: ${r.judgmentScalars.enum[s].agree}`)
  for (const s of Object.keys(r.judgmentScalars.value_presence)) L.push(`- ${s}: ${r.judgmentScalars.value_presence[s].presenceAgree} (presence)`)
  L.push(``, `## jobFamily confusion (regex row → llm col)`)
  for (const rf of Object.keys(r.jobFamilyConfusion).sort()) {
    const row = r.jobFamilyConfusion[rf]
    L.push(`- ${rf}: ${Object.entries(row).map(([k, v]) => `${k}=${v}`).join(", ")}`)
  }
  return L.join("\n") + "\n"
}

main()
