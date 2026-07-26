#!/usr/bin/env tsx
// Unit tests for the deterministic gate-ledger core (defect #1, step 1).
// Hand-built GateCandidate[] + ProfileEvidence — no classifier, no engine, no LLM.
//   Run: npx tsx app/api/jobfit/gateLedger.test.ts

import {
  buildGateLedger,
  applyLedgerCap,
  type GateCandidate,
  type ProfileEvidence,
} from "./gateLedger"

let pass = 0
let fail = 0
function eq<T>(name: string, got: T, want: T) {
  const ok = got === want
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
  }
}

// Minimal ProfileEvidence with everything empty/unknown; override as needed.
function ev(partial: Partial<ProfileEvidence>): ProfileEvidence {
  return {
    totalYears: null,
    domainYears: {},
    managerOfManagersYears: null,
    toolsInExperience: [],
    toolsInSkillsOnly: [],
    licensesHeld: [],
    clearancesHeld: [],
    citizenshipStated: null,
    degreeHeld: null,
    waiverOnFile: false,
    skillRecency: {},
    ...partial,
  }
}
const status = (c: GateCandidate, e: ProfileEvidence) => buildGateLedger([c], e)[0].status

// ── experience: domain-scoped (01 Jordan vs 07 Reyna, b2b_saas_3yr) ──────────
const b2b: GateCandidate = {
  gate_id: "b2b_saas_3yr", required: true, trigger_span: "at least 3 in B2B SaaS",
  spec: { kind: "experience", years: 3, scope: { domain: "b2b_saas" } },
}
console.log("experience / domain-scoped")
eq("01 Jordan: 5 total yrs, 0 in B2B SaaS -> UNMET", status(b2b, ev({ totalYears: 5, domainYears: {} })), "UNMET")
eq("07 Reyna: 5 yrs in B2B SaaS -> MET", status(b2b, ev({ totalYears: 5, domainYears: { b2b_saas: 5 } })), "MET")
eq("domain yrs below threshold -> UNMET", status(b2b, ev({ domainYears: { b2b_saas: 2 } })), "UNMET")

// ── experience: total + manager-of-managers (03 Marcus) ──────────────────────
const yoe10: GateCandidate = {
  gate_id: "yoe_10", required: true, trigger_span: "10+ years in software engineering",
  spec: { kind: "experience", years: 10, scope: "total" },
}
const mgr5: GateCandidate = {
  gate_id: "manager_of_managers_5yr", required: true, trigger_span: "5+ years managing managers",
  spec: { kind: "experience", years: 5, scope: "manager_of_managers" },
}
console.log("experience / total + manager-of-managers")
eq("03 Marcus: 2 yrs vs 10 -> UNMET", status(yoe10, ev({ totalYears: 2 })), "UNMET")
eq("03 Marcus: mgr-of-mgrs 0 vs 5 -> UNMET", status(mgr5, ev({ managerOfManagersYears: 0 })), "UNMET")
eq("total yrs unknown -> UNKNOWN", status(yoe10, ev({ totalYears: null })), "UNKNOWN")
eq("mgr-of-mgrs met -> MET", status(mgr5, ev({ managerOfManagersYears: 6 })), "MET")

// ── experience: recency + version (04 Dana, Angular v14+) ────────────────────
const angular: GateCandidate = {
  gate_id: "recent_angular_v14_3yr", required: true,
  trigger_span: "3+ years recent hands-on Angular (v14+), last two roles",
  spec: { kind: "experience", years: 3, scope: { domain: "angular" }, recency: { versionMin: 14, withinLastNRoles: 2 } },
}
console.log("experience / recency + version")
eq("04 Dana: Angular v5 in role 1 (stale/old version) -> UNMET",
  status(angular, ev({ domainYears: { angular: 3 }, skillRecency: { angular: { lastUsedRoleIndex: 1, version: 5 } } })), "UNMET")
eq("fresh Angular v16 in current role -> MET",
  status(angular, ev({ domainYears: { angular: 4 }, skillRecency: { angular: { lastUsedRoleIndex: 0, version: 16 } } })), "MET")
eq("right version but too many roles back -> UNMET",
  status(angular, ev({ domainYears: { angular: 4 }, skillRecency: { angular: { lastUsedRoleIndex: 3, version: 16 } } })), "UNMET")
eq("skill absent entirely -> UNMET", status(angular, ev({})), "UNMET")

// ── tool: in-EXPERIENCE vs SKILLS-only (05 Tyler, 07 Reyna) + OR gate ─────────
const dbt: GateCandidate = {
  gate_id: "dbt_handson", required: true, trigger_span: "hands-on dbt",
  spec: { kind: "tool", anyOf: ["dbt"] },
}
const crm: GateCandidate = {
  gate_id: "crm_pipeline", required: true, trigger_span: "Salesforce or HubSpot pipeline data",
  spec: { kind: "tool", anyOf: ["salesforce", "hubspot"] },
}
console.log("tool / evidence-locus + OR")
eq("05 Tyler: dbt in SKILLS blob only -> UNMET", status(dbt, ev({ toolsInSkillsOnly: ["dbt", "snowflake"] })), "UNMET")
eq("07 Reyna: dbt in EXPERIENCE -> MET", status(dbt, ev({ toolsInExperience: ["dbt"] })), "MET")
eq("07 crm OR: HubSpot in EXPERIENCE -> MET", status(crm, ev({ toolsInExperience: ["hubspot"] })), "MET")
eq("crm absent everywhere -> UNMET", status(crm, ev({})), "UNMET")

// ── credential: clearance / citizenship / degree (02 Priya) ──────────────────
const clearance: GateCandidate = {
  gate_id: "ts_sci_clearance", required: true, trigger_span: "active TS/SCI clearance",
  spec: { kind: "credential", credentialType: "clearance", id: "ts_sci" },
}
const citizenship: GateCandidate = {
  gate_id: "us_citizenship", required: true, trigger_span: "must be a US citizen",
  spec: { kind: "credential", credentialType: "citizenship" },
}
const degree: GateCandidate = {
  gate_id: "degree_or_waiver", required: true, trigger_span: "Bachelor's or DoD waiver on file",
  spec: { kind: "credential", credentialType: "degree", waiverPath: "specific" },
}
console.log("credential / clearance + citizenship + degree")
eq("02 clearance silent -> UNMET", status(clearance, ev({})), "UNMET")
eq("clearance held -> MET", status(clearance, ev({ clearancesHeld: ["ts_sci"] })), "MET")
eq("02 citizenship silent -> UNKNOWN", status(citizenship, ev({})), "UNKNOWN")
eq("citizenship stated false -> UNMET", status(citizenship, ev({ citizenshipStated: false })), "UNMET")
eq("02 degree: 'No degree', no waiver -> UNMET", status(degree, ev({ degreeHeld: false, waiverOnFile: false })), "UNMET")
eq("degree held -> MET", status(degree, ev({ degreeHeld: true })), "MET")
eq("degree via specific waiver -> MET", status(degree, ev({ degreeHeld: false, waiverOnFile: true })), "MET")

// ── credential: E5 compound + substitute license (06 Merrill) ────────────────
const finra: GateCandidate = {
  gate_id: "finra_sie_series7_series66", required: true,
  trigger_span: "SIE, Series 7, and Series 66 (63 and 65 in lieu of 66)",
  spec: {
    kind: "credential", credentialType: "license",
    requires: [{ id: "sie" }, { id: "series_7" }, { id: "series_66", substitutes: [["series_63", "series_65"]] }],
  },
}
console.log("credential / E5 compound + substitute")
eq("06 all three held -> MET", status(finra, ev({ licensesHeld: ["sie", "series_7", "series_66"] })), "MET")
eq("06 63+65 in lieu of 66 -> MET", status(finra, ev({ licensesHeld: ["sie", "series_7", "series_63", "series_65"] })), "MET")
eq("06 missing Series 7 -> UNMET", status(finra, ev({ licensesHeld: ["sie", "series_66"] })), "UNMET")
eq("06 partial substitute (only 63) -> UNMET", status(finra, ev({ licensesHeld: ["sie", "series_7", "series_63"] })), "UNMET")
eq("06 no licenses at all -> UNMET", status(finra, ev({})), "UNMET")

// ── cap rule + guards ─────────────────────────────────────────────────────────
console.log("cap rule / guards")
eq("UNMET required floors Apply -> Pass",
  applyLedgerCap("Apply", buildGateLedger([b2b], ev({ domainYears: {} }))), "Pass")
eq("all-MET preserves Apply (Guard 1: MET-is-inert)",
  applyLedgerCap("Apply", buildGateLedger([b2b], ev({ domainYears: { b2b_saas: 5 } }))), "Apply")
eq("UNKNOWN required caps like UNMET -> Pass",
  applyLedgerCap("Apply", buildGateLedger([citizenship], ev({}))), "Pass")
eq("preferred (required=false) UNMET does NOT cap (Guard 3)",
  applyLedgerCap("Apply", buildGateLedger([{ ...b2b, required: false }], ev({ domainYears: {} }))), "Apply")
eq("07 Reyna full ledger all-MET stays Apply",
  applyLedgerCap(
    "Apply",
    buildGateLedger([b2b, dbt, crm], ev({ domainYears: { b2b_saas: 5 }, toolsInExperience: ["dbt", "hubspot"] })),
  ),
  "Apply")
eq("Priority Apply also floored on UNMET -> Pass",
  applyLedgerCap("Priority Apply", buildGateLedger([b2b], ev({ domainYears: {} }))), "Pass")

console.log(`\n${pass}/${pass + fail} assertions passed`)
process.exit(fail > 0 ? 1 : 0)
