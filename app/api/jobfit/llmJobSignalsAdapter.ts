// app/api/jobfit/llmJobSignalsAdapter.ts
//
// Adapter: LLMJobExtraction (the Stage-1 LLM JD extractor output) → the
// StructuredJobSignals shape the deterministic scoring spine consumes.
//
// SHADOW-FIRST: this has no live caller yet. It exists so the shadow-scoring
// harness can feed LLM-fed signals through the SAME scoring spine and diff the
// result against the regex-fed baseline, before any cutover. The live engine
// still runs extractJobSignals (regex).
//
// Locked conventions (see docs / adapter recon):
//   (a) unit ids minted the regex way — stableHash("job|" + key + "|" + raw
//       requirement_text); within-job-set only, never compared cross-side.
//   (b) canonical_key="tool" units are NOT emitted as requirement_units; their
//       tool_name is routed into requiredTools[]/preferredTools[] (by
//       requiredness) and unioned with the LLM's own tool scalar arrays —
//       mirrors regex, which never keys a unit "tool" and scores tools through
//       the scalar channel.
//   (c) canonical_key="other" units ARE emitted (so the "other"-rate stays
//       countable) but the spine excludes key="other" in buildCoverage, so they
//       never fire RISK_MISSING_PROOF / a penalty / a coverage drag.
//
// This phase fills only the score-affecting gap fields faithfully (jobTitle,
// degrees[]); scoring-inert display fields (companyName, internship, …) get
// safe defaults — faithful display fill is a cutover follow-up.

import type {
  StructuredJobSignals,
  JobRequirementUnit,
  DegreeRequirement,
  FunctionTag,
  EvidenceKind,
} from "./signals"
import type { LLMJobExtraction, LLMRequirementUnit } from "./jdExtractionPrompt"
import { stableHash, compressJobSnippet, extractJobTitle } from "./extract"

// Runtime mirror of the FunctionTag union (signals.ts). LLM function tags are
// free strings; anything outside this set is dropped (no blind cast).
const VALID_FUNCTION_TAGS: ReadonlySet<string> = new Set<FunctionTag>([
  "brand_marketing",
  "communications_pr",
  "creative_design",
  "content_social",
  "consumer_insights_research",
  "data_analytics_bi",
  "growth_performance",
  "product_marketing",
  "sales_bd",
  "government_cleared",
  "legal_regulatory",
  "finance_corp",
  "accounting_finops",
  "premed_clinical",
  "operations_general",
  "consulting_strategy",
  "engineering_technical",
  "software_it",
  "healthcare_clinical",
  "trades_skilled",
  "other",
])

function asFunctionTag(s: string | null | undefined): FunctionTag | undefined {
  return s && VALID_FUNCTION_TAGS.has(s) ? (s as FunctionTag) : undefined
}

function uniqueLower(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const t = String(raw || "").trim().toLowerCase()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

// Collapse same-key matchable units to ONE merged unit per key, restoring the
// one-unit-per-key invariant the scoring spine was calibrated for (regex emits
// at most one unit per key). The LLM decomposes a JD into many granular lines,
// several legitimately sharing a capability key; left un-merged they fan out
// the job×profile match cross-product (N×M) and multiply coverage obligations.
//
// Merge rules: requiredness = "core" if ANY instance is core; strength = MAX;
// kind = modal (tie-break → the strongest instance's kind); snippet = the
// strongest instance's line (NOT concatenated — keeps evidenceShapeCompatible
// regexes coherent); distinct responsibility texts retained in `tags` (unread
// by scoring) for later WHY rendering; id re-minted on the strongest line.
//
// NOTE: "other" units are NOT passed here — they never match/cover and all
// share key="other", so collapsing would destroy their per-requirement count.
function mergeMatchableByKey(units: LLMRequirementUnit[]): JobRequirementUnit[] {
  const groups = new Map<string, LLMRequirementUnit[]>()
  for (const u of units) {
    const g = groups.get(u.canonical_key)
    if (g) g.push(u)
    else groups.set(u.canonical_key, [u])
  }

  const out: JobRequirementUnit[] = []
  for (const [key, group] of groups) {
    // Strongest instance (deterministic): max strength → core over supporting → first.
    const strongest = group.reduce((best, u) => {
      if (u.strength !== best.strength) return u.strength > best.strength ? u : best
      const uCore = u.requiredness === "core" ? 1 : 0
      const bCore = best.requiredness === "core" ? 1 : 0
      return uCore > bCore ? u : best
    }, group[0])

    // Modal kind; ties resolve to the strongest instance's kind.
    const kindCounts = new Map<string, number>()
    for (const u of group) kindCounts.set(u.kind, (kindCounts.get(u.kind) || 0) + 1)
    let modalKind: string = strongest.kind
    let modalCount = -1
    for (const [k, c] of kindCounts) {
      if (c > modalCount || (c === modalCount && k === strongest.kind)) { modalKind = k; modalCount = c }
    }

    const anyCore = group.some((u) => u.requiredness === "core")
    const maxStrength = Math.max(...group.map((u) => u.strength))
    const strongestRaw = strongest.requirement_text || ""
    // Distinct responsibility texts (whitespace-normalized) retained for WHY rendering.
    const tags = [...new Set(
      group.map((u) => String(u.requirement_text || "").replace(/\s+/g, " ").trim()).filter(Boolean),
    )]

    out.push({
      id: stableHash(`job|${key}|${strongestRaw}`),
      kind: modalKind as EvidenceKind,
      key,
      label: strongest.label,
      snippet: compressJobSnippet(strongestRaw),
      requiredness: anyCore ? "core" : "supporting",
      strength: maxStrength,
      functionTag: asFunctionTag(strongest.functionTag),
      tags,
    })
  }
  return out
}

export function llmJobExtractionToSignals(
  llm: LLMJobExtraction,
  ctx: { jobText: string; userJobTitle?: string },
): StructuredJobSignals {
  const s = llm.scalars
  const allUnits = Array.isArray(llm.requirement_units) ? llm.requirement_units : []

  // ── (b) Tools → scalar channel ────────────────────────────────────────────
  // Route canonical_key="tool" units' tool_name into required/preferred by
  // requiredness, then union with the LLM's own tool scalar arrays.
  const toolUnitsRequired: string[] = []
  const toolUnitsPreferred: string[] = []
  for (const u of allUnits) {
    if (u.canonical_key !== "tool") continue
    const name = u.tool_name
    if (!name) continue
    if (u.requiredness === "core") toolUnitsRequired.push(name)
    else toolUnitsPreferred.push(name)
  }
  const requiredTools = uniqueLower([...(s.requiredTools || []), ...toolUnitsRequired])
  const preferredTools = uniqueLower([...(s.preferredTools || []), ...toolUnitsPreferred])

  // ── Requirement units — three-way partition ────────────────────────────────
  // tool  → dropped (routed to scalar arrays above).
  // other → 1:1 passthrough (kept for countability; coverage-excluded by spine).
  // else  → merged to one unit per key (restores the spine's one-per-key invariant).
  const matchable: LLMRequirementUnit[] = []
  const otherUnits: JobRequirementUnit[] = []
  for (const u of allUnits) {
    if (u.canonical_key === "tool") continue
    if (u.canonical_key === "other") {
      const rawSnippet = u.requirement_text || ""
      otherUnits.push({
        // Mirror regex makeJobUnit: id hashes the RAW snippet; snippet field compressed.
        id: stableHash(`job|other|${rawSnippet}`),
        kind: u.kind as EvidenceKind, // UnitKind ≡ EvidenceKind
        key: "other",
        label: u.label,
        snippet: compressJobSnippet(rawSnippet),
        requiredness: u.requiredness,
        strength: u.strength,
        functionTag: asFunctionTag(u.functionTag),
      })
      continue
    }
    matchable.push(u)
  }
  const requirement_units: JobRequirementUnit[] = [
    ...mergeMatchableByKey(matchable),
    ...otherUnits,
  ]

  // ── (e) degrees[] synthesized from booleans (field_kind:"none") ────────────
  // Mirrors the regex degree populator exactly; licensure gate stays inert.
  // degrees[] now come straight from the LLM (jd-extract-v3 schema); pass them
  // through. field_kind is LLM-judged (conservative default "directional"),
  // unblocking Move B (the degree-licensure gate) as a separate follow-up.
  const degrees: DegreeRequirement[] = Array.isArray(s.degrees) ? s.degrees : []

  // ── function_tags (filter to enum) ─────────────────────────────────────────
  const function_tags = (s.function_tags || [])
    .map((t) => asFunctionTag(t))
    .filter((t): t is FunctionTag => t !== undefined)

  // ── jobTitle (score-affecting): user value, else regex fallback, else null ──
  // LLM extraction is title-blind. Title-less cases (some synthetic) diverge
  // from regex by wiring, not by engine signal — noted in the shadow report.
  const rawLines = ctx.jobText.split(/\r?\n/)
  const jobTitle = ctx.userJobTitle || extractJobTitle(rawLines) || null

  return {
    rawHash: stableHash(ctx.jobText), // identity only; not compared in shadow
    jobTitle,
    companyName: null, // scoring-inert; faithful fill is a cutover follow-up
    jobFamily: s.jobFamily,
    financeSubFamily: s.financeSubFamily,
    salesSubFamily: s.salesSubFamily,
    analytics: { isHeavy: s.analytics?.isHeavy ?? false, isLight: false }, // isLight scoring-inert
    function_tags,
    location: {
      mode: s.location?.mode ?? "unclear",
      city: s.location?.city ?? null,
      evidence: null, // scoring-inert
    },
    isGovernment: s.isGovernment,
    isSalesHeavy: s.isSalesHeavy,
    isContract: s.isContract,
    isHourly: s.isHourly,
    isPartTime: s.isPartTime,
    // Clamp to the regex-path rule (extract.ts extractYearsRequired :2566): a
    // value in (0, 20] is a real minimum; 0 / negative / >20 / null collapse to
    // null. Mirrors "0 min = entry-level → no requirement" so a range low-end of
    // 0 (or an LLM stray) never scores as an experience gap.
    yearsRequired:
      typeof s.yearsRequired === "number" && s.yearsRequired > 0 && s.yearsRequired <= 20
        ? s.yearsRequired
        : null,
    degrees,
    credentialRequired: s.credentialRequired,
    credentialDetail: s.credentialDetail,
    credentialSponsored: s.credentialSponsored,
    gradYearHint: s.gradYearHint,
    requiredTools,
    preferredTools,
    reportingSignals: {
      strong: requirement_units.some(
        (u) => u.key === "analysis_reporting" && u.requiredness === "core",
      ),
    },
    requirement_units,
    // internship omitted (optional field; scoring-inert)
    isSeniorRole: s.isSeniorRole,
    isTrainingProgram: s.isTrainingProgram,
    requiresAECExperience: false, // scoring-inert; no reader in scoring/constraints/decision
    requiresDomainIndustryExperience: s.requiresDomainIndustryExperience,
    detectedDomain: s.detectedDomain,
    requiresAdvisoryBackground: s.requiresAdvisoryBackground,
    requiresFinancialModeling: s.requiresFinancialModeling,
    requiresSoftCredential: s.requiresSoftCredential,
    // Parity with regex: detail only when the soft-credential flag is set.
    softCredentialDetail: s.requiresSoftCredential ? (s.softCredentialDetail ?? null) : null,
    jobArchetype: s.jobArchetype,
    isContentExecutionHeavy: s.isContentExecutionHeavy,
    jobIndustry: s.jobIndustry,
  }
}
