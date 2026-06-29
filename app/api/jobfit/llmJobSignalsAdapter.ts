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
import type { LLMJobExtraction } from "./jdExtractionPrompt"
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

  // ── Requirement units (drop "tool"; keep "other" for countability) ─────────
  const requirement_units: JobRequirementUnit[] = allUnits
    .filter((u) => u.canonical_key !== "tool")
    .map((u) => {
      const key = u.canonical_key // "other" passes through; spine excludes it in buildCoverage
      const rawSnippet = u.requirement_text || ""
      return {
        // Mirror regex makeJobUnit exactly: id hashes the RAW snippet; the
        // stored snippet field is compressed.
        id: stableHash(`job|${key}|${rawSnippet}`),
        kind: u.kind as EvidenceKind, // UnitKind ≡ EvidenceKind
        key,
        label: u.label,
        snippet: compressJobSnippet(rawSnippet),
        requiredness: u.requiredness,
        strength: u.strength,
        functionTag: asFunctionTag(u.functionTag),
      }
    })

  // ── (e) degrees[] synthesized from booleans (field_kind:"none") ────────────
  // Mirrors the regex degree populator exactly; licensure gate stays inert.
  const degrees: DegreeRequirement[] = []
  if (s.bachelorRequired)
    degrees.push({ level: "bachelor", requiredness: "required", field: null, field_kind: "none" })
  if (s.mbaRequired)
    degrees.push({ level: "mba", requiredness: "required", field: null, field_kind: "none" })

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
      constrained: s.location?.constrained ?? false,
      city: s.location?.city ?? null,
      evidence: null, // scoring-inert
    },
    isGovernment: s.isGovernment,
    isSalesHeavy: s.isSalesHeavy,
    isContract: s.isContract,
    isHourly: s.isHourly,
    yearsRequired: s.yearsRequired,
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
    // NOTE: s.isPartTime is emitted by the LLM but StructuredJobSignals has no
    // field for it yet — intentionally not mapped (spine field-add deferred).
  }
}
