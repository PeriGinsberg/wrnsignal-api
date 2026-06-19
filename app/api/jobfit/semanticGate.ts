// app/api/jobfit/semanticGate.ts
//
// Semantic evidence-relevance layer — STAGE 1: suspect-match gate (PURE, no
// LLM). See docs/jobfit-semantic-relevance-layer-scope.md.
//
// A match is "suspect" when a GENERIC / transferable capability is credited
// toward a SPECIALIZED requirement (or a domain that recontextualizes it),
// AND the candidate is NOT independently in-field. Suspect matches are the only
// ones Stage 2 sends to the LLM relevance check. In-field candidates are
// excluded HERE and never reach the call — that structural exclusion is the
// true-fit protection, not the LLM verdict.
//
// Design grounded in the Stage-1 match dump:
//   - The over-credit mechanism is the ADJACENCY stretch generic→specialized
//     (e.g. analysis_reporting → financial_analysis), NOT generic→generic
//     direct matches (analysis_reporting → analysis_reporting), which are a
//     generic requirement legitimately met by generic evidence.
//   - Genuine in-field standing is a DIRECT match on an APEX specialized
//     capability (financial_analysis, clinical_*, policy_regulatory_research,
//     med_device_industry_knowledge). accounting_operations is NOT apex — it
//     fires on coursework (Ava's "Financial Accounting"), which is exactly the
//     case we must keep flaggable.
//
// Residuals this flags (and nothing clearly in-field):
//   - Ava/J4, Ava/J6: analysis_reporting → financial_analysis (adjacent).
//   - Jordan/Zurich: customer_service_guest_experience (direct) on an
//     insurance/underwriting JD.

import type { StructuredJobSignals } from "./signals"

// Minimal structural view of a scoring WhyEvidenceMatch — only what the gate
// reads. scoring.ts maps its matches into this shape (avoids a type cycle).
export type GateMatch = {
  job_unit_key: string         // the JD requirement key (= match_key)
  profile_unit_key: string     // the candidate capability that matched it
  match_strength: "direct" | "adjacent"
  weight: number
  job_fact?: string            // the requirement snippet — lets us catch a
                               // specialized requirement that was mis-keyed as
                               // generic (e.g. "build financial models (DCF,
                               // LBO)" extracted as analysis_reporting)
}

// ── Curated sets ─────────────────────────────────────────────────────────────

// GENERIC / transferable capabilities (candidate EVIDENCE side). Real but
// domain-agnostic; routinely stretched onto specialized requirements.
export const GENERIC_CAPABILITIES = new Set<string>([
  "analysis_reporting",
  "drafting_documentation",
  "operations_execution",
  "consumer_research",
  "communications_writing",
  "strategy_problem_solving",
  "stakeholder_coordination",
])

// SPECIALIZED requirements (JD side). Domain work a generic capability does not
// automatically satisfy. A generic capability credited toward one of these is
// the core suspect signal (Ava: analysis_reporting → financial_analysis).
export const SPECIALIZED_REQUIREMENTS = new Set<string>([
  "financial_analysis",
  "accounting_operations",
  "policy_regulatory_research",
  "clinical_patient_work",
  "clinical_stakeholder_fluency",
  "med_device_industry_knowledge",
])

// APEX specialized capabilities. A DIRECT match where BOTH sides are one of
// these proves the candidate is genuinely in-domain → fully protected. This is
// deliberately NARROWER than SPECIALIZED_REQUIREMENTS: accounting_operations
// and hospital_or_environment are excluded because they fire on coursework /
// soft context and would falsely protect cross-domain candidates (Ava).
export const APEX_SPECIALIZED_CAPABILITIES = new Set<string>([
  "financial_analysis",
  "policy_regulatory_research",
  "clinical_patient_work",
  "clinical_stakeholder_fluency",
  "med_device_industry_knowledge",
])

// Specialized-requirement signals detected from the requirement TEXT, to catch
// a specialized requirement that was mis-keyed as a generic one (e.g. an IB JD's
// "Build financial models (DCF, LBO, comparable company analysis)" extracted
// under analysis_reporting). When a generic capability is credited toward a
// requirement whose text carries one of these, it is suspect regardless of key.
const SPECIALIZED_REQUIREMENT_KEYWORDS = [
  "financial model", "valuation", "dcf", "lbo", "comparable company",
  "leveraged buyout", "capital markets", "three-statement", "3-statement",
  "underwriting", "actuarial", "litigation", "regulatory filing",
  "clinical trial",
]

function requirementTextIsSpecialized(jobFact?: string): boolean {
  if (!jobFact) return false
  const hay = jobFact.toLowerCase()
  return SPECIALIZED_REQUIREMENT_KEYWORDS.some((k) => hay.includes(k))
}

// Relational generics whose meaning is recontextualized by a specialized
// service domain (charity guest-services ≠ underwriting customer interaction).
const DOMAIN_RECONTEXTUALIZED_GENERICS = new Set<string>([
  "customer_service_guest_experience",
])

// Domains where a generic relational capability does not transfer. Keyword
// scan over requirement snippets — coarse RECALL filter only; the Stage 2 LLM
// makes the actual relevance call.
const RECONTEXTUALIZING_DOMAIN_KEYWORDS = [
  "underwriting", "underwriter", "insurance", "insurer", "policyholder",
  "actuarial", "reinsurance", "claims adjust",
  "clinical", "patient care", "diagnosis",
]

function jdHaystack(job: StructuredJobSignals): string {
  return (job.requirement_units || [])
    .map((u) => String((u as any).snippet || "").toLowerCase())
    .join(" \n ")
}

function isRecontextualizingDomain(job: StructuredJobSignals): boolean {
  const hay = jdHaystack(job)
  return RECONTEXTUALIZING_DOMAIN_KEYWORDS.some((k) => hay.includes(k))
}

// Candidate is in-field iff they have a DIRECT match on an apex specialized
// capability. If so, none of their matches are suspect (in-field never reaches
// the LLM).
export function candidateIsInField(matches: GateMatch[]): boolean {
  return matches.some(
    (m) =>
      m.match_strength === "direct" &&
      APEX_SPECIALIZED_CAPABILITIES.has(m.job_unit_key) &&
      APEX_SPECIALIZED_CAPABILITIES.has(m.profile_unit_key)
  )
}

function isSuspect(m: GateMatch, job: StructuredJobSignals): boolean {
  // Rule A — generic capability credited toward a SPECIALIZED requirement,
  // identified by key OR by requirement text (the latter catches specialized
  // requirements mis-keyed as generic, e.g. "build financial models (DCF, LBO)"
  // extracted as analysis_reporting). Catches Ava (both the adjacency stretch to
  // financial_analysis AND the direct match on the mis-keyed modeling line).
  if (
    GENERIC_CAPABILITIES.has(m.profile_unit_key) &&
    (SPECIALIZED_REQUIREMENTS.has(m.job_unit_key) || requirementTextIsSpecialized(m.job_fact))
  ) {
    return true
  }
  // Rule B — a relational generic credited DIRECTLY on a domain that
  // recontextualizes it (insurance/underwriting/clinical). Catches Jordan.
  if (
    m.match_strength === "direct" &&
    DOMAIN_RECONTEXTUALIZED_GENERICS.has(m.profile_unit_key) &&
    m.job_unit_key === m.profile_unit_key &&
    isRecontextualizingDomain(job)
  ) {
    return true
  }
  return false
}

// The gate. Returns suspect matches (empty if candidate is in-field).
export function suspectMatches(matches: GateMatch[], job: StructuredJobSignals): GateMatch[] {
  if (candidateIsInField(matches)) return []
  return matches.filter((m) => isSuspect(m, job))
}

// Distinct (evidence → requirement, strength) pairs — one LLM verdict per pair.
export function distinctSuspectPairs(
  suspects: GateMatch[]
): Array<{ profile_unit_key: string; job_unit_key: string; match_strength: string }> {
  const seen = new Set<string>()
  const out: Array<{ profile_unit_key: string; job_unit_key: string; match_strength: string }> = []
  for (const s of suspects) {
    const k = `${s.profile_unit_key}→${s.job_unit_key}:${s.match_strength}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ profile_unit_key: s.profile_unit_key, job_unit_key: s.job_unit_key, match_strength: s.match_strength })
  }
  return out
}
