// FILE: app/api/jobfit/riskDetectors.ts
//
// Defect #3 — risk under-detection detectors. Opt-in / OFF by default (same
// posture as #1/#2). Reuses the #1 ProfileEvidence + gateClassifier extractors
// and the #2 verbEvidence — no third résumé parser. See DESIGN-risk-detectors.md.
//
// STEP 1 (this file, first pass): the presence-based, verb-agnostic detectors
// (domain_gap, crm_pipeline_absent, revenue_metrics_absent) + stale_skill. These
// fire on ENTIRELY-ABSENT / present-but-stale evidence, so they read PRESENCE
// (not verb class) — which is why they stay off Alex (09), who has the evidence.

import type { GateCandidate, ProfileEvidence } from "./gateLedger"
import { buildGateLedger } from "./gateLedger"
import type { RiskCode, Severity } from "./signals"
import type { VerbBullet } from "./verbEvidence"
import { extractRequirementsSection, extractPreferredSection } from "./gateClassifier"

const PREFERRED_TOOL_VOCAB = ["dbt", "snowflake", "airflow", "spark", "salesforce", "hubspot", "pytorch", "tensorflow", "angular", "tableau", "looker", "kafka"]

const CRM_TOOLS = ["salesforce", "hubspot", "dynamics", "pipedrive"]
const REVENUE_METRIC_TOKENS = ["cac", "ltv", "mrr", "arr", "payback", "pipeline velocity", "nrr"]

function rc(code: string, severity: Severity, job_fact: string, risk: string): RiskCode {
  return { code, severity, job_fact, risk }
}

export type RiskDetectorInput = {
  jobText: string
  profileText: string
  candidates: GateCandidate[] // classifyRequirements(jobText)
  evidence: ProfileEvidence // extractProfileEvidence(profileText)
}

// Step-1 detectors. Returns engine RiskCodes (deduped by code).
export function detectPresenceRisks(input: RiskDetectorInput): RiskCode[] {
  const { jobText, profileText, candidates, evidence } = input
  const out: RiskCode[] = []
  const resume = profileText.toLowerCase()
  const jd = jobText.toLowerCase()

  // 1. domain_gap (HIGH) — a required NON-recency domain is entirely absent.
  // (Recency-qualified domains are handled by stale_skill; presence ≠ absence.)
  for (const c of candidates) {
    if (c.spec.kind === "experience" && typeof c.spec.scope === "object" && !c.spec.recency) {
      const domain = c.spec.scope.domain
      if (evidence.domainYears[domain] === undefined) {
        out.push(rc("RISK_DOMAIN_GAP", "high", `Requires experience in ${domain}`, `No experience in the required domain (${domain}).`))
      }
    }
  }

  // 2. crm_pipeline_absent (HIGH) — a required CRM/pipeline tool is absent
  // everywhere (EXPERIENCE and SKILLS), verb-agnostic.
  const allTools = new Set([...evidence.toolsInExperience, ...evidence.toolsInSkillsOnly])
  for (const c of candidates) {
    if (c.spec.kind === "tool") {
      const crmReq = c.spec.anyOf.filter((t) => CRM_TOOLS.includes(t))
      if (crmReq.length > 0 && !crmReq.some((t) => allTools.has(t))) {
        out.push(rc("RISK_CRM_ABSENT", "high", `Requires ${crmReq.join("/")}`, `No CRM/pipeline tool (${crmReq.join("/")}) in the résumé.`))
      }
    }
  }

  // 3. revenue_metrics_absent (HIGH) — the role reports revenue metrics to
  // leadership and the résumé shows NONE of them. Verb-agnostic token scan.
  const jdMetrics = REVENUE_METRIC_TOKENS.filter((t) => jd.includes(t))
  if (jdMetrics.length > 0 && !REVENUE_METRIC_TOKENS.some((t) => resume.includes(t))) {
    out.push(rc("RISK_REVENUE_METRICS_ABSENT", "high", `Role reports ${jdMetrics.join(", ")}`, `No revenue metrics (CAC/LTV/MRR/pipeline) shown in the résumé.`))
  }

  // 4. stale_skill (MEDIUM) — a required-recent skill is PRESENT but stale (old
  // version and/or last used outside the recency window). Reuses skillRecency.
  for (const c of candidates) {
    if (c.spec.kind === "experience" && typeof c.spec.scope === "object" && c.spec.recency) {
      const skill = c.spec.scope.domain
      const rec = evidence.skillRecency[skill]
      if (rec) {
        const oldVersion = c.spec.recency.versionMin !== undefined && (rec.version ?? 0) < c.spec.recency.versionMin
        const tooOld = c.spec.recency.withinLastNRoles !== undefined && rec.lastUsedRoleIndex >= c.spec.recency.withinLastNRoles
        if (oldVersion || tooOld) {
          out.push(rc("RISK_STALE_SKILL", "medium", `Requires recent ${skill}`, `${skill} is present but stale (old version and/or not recent).`))
        }
      }
    }
  }

  // 5. hard_credential_absent (HIGH) — a required credential gate is not MET.
  // Reuses the #1 gate ledger: an UNMET/UNKNOWN required credential is a wall.
  const credLedger = buildGateLedger(candidates.filter((c) => c.spec.kind === "credential"), evidence)
  const unmetCred = credLedger.filter((e) => e.required && e.status !== "MET")
  if (unmetCred.length > 0) {
    const which = unmetCred.map((e) => e.gate_id).join(", ")
    out.push(rc("RISK_HARD_CREDENTIAL_ABSENT", "high", `Requires ${which}`, `Required credential(s) absent/unconfirmed: ${which}.`))
  }

  // 6. preferred_item_missing (LOW, non-blocking) — a PREFERRED named tool is
  // absent. Never gates and never downgrades (low severity is informational).
  const pref = extractPreferredSection(jobText)
  if (pref) {
    const prefLower = pref.toLowerCase()
    const missing = PREFERRED_TOOL_VOCAB.filter((t) => new RegExp(`\\b${t}\\b`).test(prefLower) && !allTools.has(t))
    if (missing.length > 0) {
      out.push(rc("RISK_PREFERRED_ITEM_MISSING", "low", `Preferred: ${missing.join(", ")}`, `Preferred item(s) absent (non-blocking): ${missing.join(", ")}.`))
    }
  }

  // dedupe by code (keep first)
  const seen = new Set<string>()
  return out.filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true)))
}

// ── STEP 2: semantic detectors (people_mgmt, scope_inversion) + adjacency ─────

// A management demand in the JD (requirement or duty).
const MGMT_DEMAND = /manag(?:e|ing) managers|hire and mentor|manage (?:and grow )?a? ?team|lead(?:ing)? a team|people management|grow (?:a )?(?:bench|team)|manage and grow/i
// Verbs that denote MANAGING people (leading-verb). Note "mentored" is NOT here —
// mentoring one intern is not managing.
const MGMT_VERBS = new Set(["hired", "hire", "managed", "manage", "led", "lead", "supervised", "directed", "grew"])
const PEOPLE_NOUNS = ["team", "analyst", "analysts", "engineer", "engineers", "report", "reports", "staff", "manager", "managers", "people"]
// A large owned span the JD demands (org/budget/manage-managers).
const LARGE_SPAN_DEMAND = /manag(?:e|ing) managers|\b\d{2,}[- ]person\b|org-level|8-figure|headcount and budget|bench of .{0,25}managers/i
// A scope-SIZE citation in a résumé bullet (team size / dollar span).
const SCOPE_SIZE = /\b\d{2,}[- ]person\b|\bteam of \d{2,}\b|\$\s?\d+\s?[mb]\b/i
// Tools the engine's adjacency graph credits as ~equivalent to a named tool.
const TOOL_ADJACENCY: Record<string, string[]> = { dbt: ["tableau", "looker"] }

function hasManagementEvidence(bullets: VerbBullet[]): boolean {
  return bullets.some(
    (b) =>
      b.leadingVerb != null &&
      MGMT_VERBS.has(b.leadingVerb) &&
      PEOPLE_NOUNS.some((n) => new RegExp(`\\b${n}\\b`).test((b.objectPhrase + " " + b.text).toLowerCase()))
  )
}

export function detectSemanticRisks(input: RiskDetectorInput & { verbBullets: VerbBullet[] }): RiskCode[] {
  const { jobText, candidates, evidence, verbBullets } = input
  const out: RiskCode[] = []
  const managesPeople = hasManagementEvidence(verbBullets)

  // 5. people_mgmt_absent — JD demands managing people, résumé shows none.
  // Severity: HIGH if the demand is a REQUIREMENT, MEDIUM if only a duty.
  if (MGMT_DEMAND.test(jobText) && !managesPeople) {
    const inReq = MGMT_DEMAND.test(extractRequirementsSection(jobText) ?? "")
    out.push(rc("RISK_PEOPLE_MGMT_ABSENT", inReq ? "high" : "medium", "Role requires managing people", "No people-management evidence in the résumé."))
  }

  // 6. scope_inversion (MEDIUM) — (a) inflated scope: a large team/budget cited
  // under a CONTRIBUTION verb (supported, not owned); OR (b) span-below: JD
  // demands a large owned span and the candidate has none.
  const inflated = verbBullets.some((b) => b.verbClass === "contribution" && SCOPE_SIZE.test(b.text))
  const spanBelow = LARGE_SPAN_DEMAND.test(jobText) && !managesPeople
  if (inflated || spanBelow) {
    out.push(rc("RISK_SCOPE_INVERSION", "medium", "Role's owned span exceeds the candidate's", "Scope inversion: support-level or below-scale span vs an ownership/large-span role."))
  }

  // 7. adjacency_inflation (MEDIUM) — a required NAMED tool is absent but an
  // adjacent skill (credited as equivalent) is present.
  const allTools = new Set([...evidence.toolsInExperience, ...evidence.toolsInSkillsOnly])
  for (const c of candidates) {
    if (c.spec.kind === "tool") {
      for (const tool of c.spec.anyOf) {
        const adj = TOOL_ADJACENCY[tool]
        if (adj && !allTools.has(tool) && adj.some((a) => allTools.has(a))) {
          out.push(rc("RISK_ADJACENCY_INFLATION", "medium", `Requires ${tool}`, `${tool} absent; an adjacent skill is being credited as equivalent.`))
        }
      }
    }
  }

  const seen = new Set<string>()
  return out.filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true)))
}

// Severity bump for an existing seniority risk when the mismatch is extreme
// (e.g. 2yr candidate vs a Director role). Both RISK_EXPERIENCE and
// RISK_SENIORITY_MISMATCH map to seniority_gap, so both are targeted. Trigger:
// an extreme YOE gap when yearsRequired is parsed, OR — since senior-role JDs
// often don't state a number — a senior-title/manage-managers role paired with a
// junior candidate. Only UPGRADES an existing seniority risk; adds nothing.
const SENIORITY_CODES = new Set(["RISK_EXPERIENCE", "RISK_SENIORITY_MISMATCH"])
export function bumpSeniorityIfExtreme(
  riskCodes: RiskCode[],
  ctx: { yearsRequired: number | null; yearsExperience: number | null; jobText: string }
): RiskCode[] {
  const { yearsRequired, yearsExperience, jobText } = ctx
  const gapExtreme = yearsRequired != null && yearsExperience != null && yearsRequired - yearsExperience >= 5
  const seniorRole = /\b(director|vp|vice president|head of|principal|chief)\b/i.test(jobText) || /manag(?:e|ing) managers/i.test(jobText)
  const juniorVsSenior = seniorRole && yearsExperience != null && yearsExperience <= 3
  if (!gapExtreme && !juniorVsSenior) return riskCodes
  return riskCodes.map((r) =>
    SENIORITY_CODES.has(r.code) && r.severity !== "high" ? { ...r, severity: "high" as Severity } : r
  )
}
