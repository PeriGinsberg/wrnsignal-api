// FILE: app/api/jobfit/gateLedger.ts
//
// Deterministic per-requirement gate ledger — defect #1 CORE (step 1).
//
// This is the DETERMINISTIC half of the gate ledger. Given classified gate
// candidates (produced by a regex classifier now, optionally an LLM classifier
// later — see "Regression Testing July 2026/DESIGN-gate-ledger.md" §6) plus a
// normalized view of the candidate's resume, it computes each gate's
// MET/UNMET/UNKNOWN status and the verdict cap. It never parses free text and
// never calls an LLM. `GateCandidate[]` is the ONLY interface between the
// classifier and this core, so regex-now and LLM-later are drop-in swaps.

export type GateStatus = "MET" | "UNMET" | "UNKNOWN"
export type GateKind = "experience" | "credential" | "tool"

// 4-level decision scale (aligns with signals.ts `Decision`; kept local so the
// core stays standalone until it is surfaced on EvalOutput in step 4).
export type LedgerDecision = "Priority Apply" | "Apply" | "Review" | "Pass"

// ── Structured specs the classifier fills; the core evaluates them ───────────

// experience: N years, optionally scoped to a domain / to manager-of-managers /
// with a recency+version qualifier (case 04).
export type ExperienceSpec = {
  kind: "experience"
  years: number
  scope: "total" | "manager_of_managers" | { domain: string }
  recency?: { versionMin?: number; withinLastNRoles?: number }
}

// credential: clearance / citizenship / degree / license. `license` is the
// compound+substitute case (E5): an AND of terms, each satisfiable by its own
// id OR any one of its substitute groups (each group an AND of ids).
export type LicenseTerm = { id: string; substitutes?: string[][] }
export type CredentialSpec =
  | { kind: "credential"; credentialType: "clearance"; id: string }
  | { kind: "credential"; credentialType: "citizenship" }
  | { kind: "credential"; credentialType: "degree"; waiverPath: "specific" | "none" }
  | { kind: "credential"; credentialType: "license"; requires: LicenseTerm[] }

// tool: OR over named tools. E3a/E3b (specialized + usage-anchored, no
// ubiquitous/example/proficiency) are applied by the classifier, not here.
export type ToolSpec = { kind: "tool"; anyOf: string[] }

export type GateSpec = ExperienceSpec | CredentialSpec | ToolSpec

export type GateCandidate = {
  gate_id: string
  required: boolean
  trigger_span: string // verbatim posting phrase this gate came from
  spec: GateSpec
}

export type GateLedgerEntry = {
  gate_id: string
  kind: GateKind
  required: boolean
  status: GateStatus
  requirement: string // = trigger_span
  evidence: string | null // resume span that decided MET, else null
}

// ── Normalized resume view the core checks against ───────────────────────────
// Built deterministically from the resume by an adapter (step 3); hand-built in
// the step-1 unit tests. All tool/license ids are lowercase-normalized
// (e.g. "series_7", "salesforce", "b2b_saas").
export type ProfileEvidence = {
  totalYears: number | null
  domainYears: Record<string, number> // {"b2b_saas": 5}; absent key => none in that domain
  managerOfManagersYears: number | null
  toolsInExperience: string[] // tools evidenced in EXPERIENCE bullets
  toolsInSkillsOnly: string[] // named only in the SKILLS blob
  licensesHeld: string[]
  clearancesHeld: string[]
  citizenshipStated: boolean | null // true / false / null(silent)
  degreeHeld: boolean | null
  waiverOnFile: boolean
  // recency per skill: which role index it was last used in (0 = most recent
  // role) and the max version seen. Absent key => skill not found.
  skillRecency: Record<string, { lastUsedRoleIndex: number; version?: number }>
}

const has = (arr: string[], id: string) => arr.indexOf(id) !== -1

// ── Per-kind status checks ───────────────────────────────────────────────────

function checkExperience(spec: ExperienceSpec, ev: ProfileEvidence): GateStatus {
  if (spec.scope === "total") {
    if (ev.totalYears === null) return "UNKNOWN"
    return ev.totalYears >= spec.years ? "MET" : "UNMET"
  }
  if (spec.scope === "manager_of_managers") {
    if (ev.managerOfManagersYears === null) return "UNKNOWN"
    return ev.managerOfManagersYears >= spec.years ? "MET" : "UNMET"
  }
  const domain = spec.scope.domain
  if (spec.recency) {
    // recency+version gate (case 04): skill must be recent enough AND >= version.
    const rec = ev.skillRecency[domain]
    if (!rec) return "UNMET" // skill absent entirely
    if (spec.recency.versionMin !== undefined && (rec.version ?? 0) < spec.recency.versionMin) return "UNMET"
    if (spec.recency.withinLastNRoles !== undefined && rec.lastUsedRoleIndex >= spec.recency.withinLastNRoles) return "UNMET"
    const y = ev.domainYears[domain]
    if (y !== undefined && y < spec.years) return "UNMET"
    return "MET"
  }
  // domain-scoped years. Absent key => 0 years in that domain => UNMET
  // (the Jordan case: real experience, none of it in the required domain).
  const yrs = ev.domainYears[domain]
  if (yrs === undefined) return "UNMET"
  return yrs >= spec.years ? "MET" : "UNMET"
}

function licenseTermSatisfied(term: LicenseTerm, held: string[]): boolean {
  if (has(held, term.id)) return true
  if (term.substitutes) {
    for (const group of term.substitutes) {
      if (group.every((id) => has(held, id))) return true
    }
  }
  return false
}

function checkCredential(spec: CredentialSpec, ev: ProfileEvidence): GateStatus {
  switch (spec.credentialType) {
    case "clearance":
      // silence => UNMET (a cleared candidate headlines it) per design §2d
      return has(ev.clearancesHeld, spec.id) ? "MET" : "UNMET"
    case "citizenship":
      if (ev.citizenshipStated === true) return "MET"
      if (ev.citizenshipStated === false) return "UNMET"
      return "UNKNOWN" // silent => UNKNOWN (often unstated even when true)
    case "degree":
      if (ev.degreeHeld === true) return "MET"
      if (spec.waiverPath === "specific" && ev.waiverOnFile) return "MET"
      if (ev.degreeHeld === false) return "UNMET" // explicit "No degree"
      return "UNKNOWN" // silent on degree
    case "license":
      // compound (AND): every term satisfied by its id OR a substitute group.
      return spec.requires.every((t) => licenseTermSatisfied(t, ev.licensesHeld)) ? "MET" : "UNMET"
  }
}

function checkTool(spec: ToolSpec, ev: ProfileEvidence): GateStatus {
  if (spec.anyOf.some((t) => has(ev.toolsInExperience, t))) return "MET"
  // present only in the SKILLS blob, or absent entirely => not evidenced => UNMET
  return "UNMET"
}

// ── Ledger build + cap ───────────────────────────────────────────────────────

export function buildGateLedger(candidates: GateCandidate[], ev: ProfileEvidence): GateLedgerEntry[] {
  return candidates.map((c) => {
    let status: GateStatus
    switch (c.spec.kind) {
      case "experience":
        status = checkExperience(c.spec, ev)
        break
      case "credential":
        status = checkCredential(c.spec, ev)
        break
      case "tool":
        status = checkTool(c.spec, ev)
        break
    }
    return {
      gate_id: c.gate_id,
      kind: c.spec.kind,
      required: c.required,
      status,
      requirement: c.trigger_span,
      evidence: status === "MET" ? c.trigger_span : null,
    }
  })
}

// Cap rule: any REQUIRED gate not MET (UNMET or UNKNOWN) floors the verdict to
// PASS, regardless of score. Preferred (required=false) entries never cap
// (Guard 3); MET gates never cap (Guard 1, MET-is-inert).
export function applyLedgerCap(decision: LedgerDecision, ledger: GateLedgerEntry[]): LedgerDecision {
  const unsatisfied = ledger.filter((e) => e.required && e.status !== "MET")
  return unsatisfied.length > 0 ? "Pass" : decision
}
