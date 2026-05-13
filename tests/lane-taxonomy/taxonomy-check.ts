// tests/lane-taxonomy/taxonomy-check.ts
//
// Unit checks for lib/laneTaxonomy.ts. Pure functions, no DB, no LLM.
//
// Run:
//   npx tsx tests/lane-taxonomy/taxonomy-check.ts
//
// Exits 1 on any failure.

import {
  LANES,
  LANE_IDS,
  STATUS_INDICATORS,
  CAREER_STAGES,
  isValidLaneId,
  isValidSubLaneId,
  getJobFamilyForLane,
  getLaneFromJobFamily,
} from "@/lib/laneTaxonomy"

const failures: string[] = []

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    const line = name + (detail ? ` — ${detail}` : "")
    failures.push(line)
    console.log(`  ✗ ${line}`)
  }
}

function jeq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ============================================================================

console.log("=== LANES structure ===")

check("12 entries (11 lanes + Other)", LANES.length === 12, `got ${LANES.length}`)

const expectedLaneIds = [
  "consulting",
  "finance",
  "accounting",
  "marketing",
  "sales_bd",
  "technology",
  "operations_strategy",
  "healthcare",
  "people_hr",
  "public_sector",
  "legal",
  "other",
]
check(
  "Lane IDs match locked list (order + values)",
  jeq(LANE_IDS, expectedLaneIds),
  `got ${JSON.stringify(LANE_IDS)}`,
)

const expectedSubLaneCounts: Record<string, number> = {
  consulting: 5,
  finance: 5,
  accounting: 3,
  marketing: 5,
  sales_bd: 4,
  technology: 6,
  operations_strategy: 4,
  healthcare: 4,
  people_hr: 5,
  public_sector: 4,
  legal: 4,
  other: 0,
}
for (const lane of LANES) {
  check(
    `${lane.id} has ${expectedSubLaneCounts[lane.id]} sub-lanes`,
    lane.subLanes.length === expectedSubLaneCounts[lane.id],
    `got ${lane.subLanes.length}`,
  )
}

const totalSubLanes = LANES.reduce((s, l) => s + l.subLanes.length, 0)
check("Total sub-lanes = 49", totalSubLanes === 49, `got ${totalSubLanes}`)

// All sub-lane ids snake_case
for (const lane of LANES) {
  for (const sub of lane.subLanes) {
    check(
      `${lane.id}.${sub.id} snake_case`,
      /^[a-z][a-z0-9_]*$/.test(sub.id),
    )
  }
}

// All sub-lane ids globally unique
const allSubIds = LANES.flatMap((l) => l.subLanes.map((s) => s.id))
const uniqueSubIds = new Set(allSubIds)
check(
  "All sub-lane IDs globally unique",
  uniqueSubIds.size === allSubIds.length,
  `${allSubIds.length} entries, ${uniqueSubIds.size} unique`,
)

// All lane labels and sub-lane labels non-empty
for (const lane of LANES) {
  check(`${lane.id} has non-empty label`, lane.label.trim().length > 0)
  for (const sub of lane.subLanes) {
    check(
      `${lane.id}.${sub.id} has non-empty label`,
      sub.label.trim().length > 0,
    )
  }
}

// Other has empty sub-lanes and a description
const other = LANES.find((l) => l.id === "other")
check("Other has 0 sub-lanes", other?.subLanes.length === 0)
check(
  "Other has description (free-text guidance)",
  (other?.description?.length ?? 0) > 0,
)

// ============================================================================

console.log("\n=== STATUS_INDICATORS / CAREER_STAGES ===")

check(
  "STATUS_INDICATORS = [premed, prelaw, pregrad]",
  jeq(STATUS_INDICATORS, ["premed", "prelaw", "pregrad"]),
)
check(
  "CAREER_STAGES = [student, early_career, mid_career, executive]",
  jeq(CAREER_STAGES, ["student", "early_career", "mid_career", "executive"]),
)

// ============================================================================

console.log("\n=== isValidLaneId ===")

check("isValidLaneId('consulting')", isValidLaneId("consulting"))
check("isValidLaneId('sales_bd')", isValidLaneId("sales_bd"))
check("isValidLaneId('people_hr')", isValidLaneId("people_hr"))
check("isValidLaneId('public_sector')", isValidLaneId("public_sector"))
check("isValidLaneId('operations_strategy')", isValidLaneId("operations_strategy"))
check("isValidLaneId('other')", isValidLaneId("other"))
check("!isValidLaneId('')", !isValidLaneId(""))
check(
  "!isValidLaneId('CONSULTING') (case-sensitive)",
  !isValidLaneId("CONSULTING"),
)
check("!isValidLaneId('garbage')", !isValidLaneId("garbage"))
check(
  "!isValidLaneId('public_sector_nonprofit') (rejected; shortened form)",
  !isValidLaneId("public_sector_nonprofit"),
)

// ============================================================================

console.log("\n=== isValidSubLaneId ===")

check(
  "isValidSubLaneId('consulting','strategy_consulting')",
  isValidSubLaneId("consulting", "strategy_consulting"),
)
check(
  "isValidSubLaneId('finance','sales_trading')",
  isValidSubLaneId("finance", "sales_trading"),
)
check(
  "isValidSubLaneId('finance','investment_banking')",
  isValidSubLaneId("finance", "investment_banking"),
)
check(
  "!isValidSubLaneId('consulting','investment_banking') (belongs to finance)",
  !isValidSubLaneId("consulting", "investment_banking"),
)
check(
  "!isValidSubLaneId('other','any_sub') (Other has no sub-lanes)",
  !isValidSubLaneId("other", "any_sub"),
)
check(
  "!isValidSubLaneId('garbage','garbage')",
  !isValidSubLaneId("garbage", "garbage"),
)

// ============================================================================

console.log("\n=== getJobFamilyForLane (forward) ===")

check(
  "getJobFamilyForLane('consulting') = ['Consulting']",
  jeq(getJobFamilyForLane("consulting"), ["Consulting"]),
)
check(
  "getJobFamilyForLane('technology') = ['IT_Software','Engineering']",
  jeq(getJobFamilyForLane("technology"), ["IT_Software", "Engineering"]),
)
check(
  "getJobFamilyForLane('healthcare') = ['Healthcare','PreMed']",
  jeq(getJobFamilyForLane("healthcare"), ["Healthcare", "PreMed"]),
)
check(
  "getJobFamilyForLane('other') = ['Other']",
  jeq(getJobFamilyForLane("other"), ["Other"]),
)
check(
  "getJobFamilyForLane('garbage') = []",
  jeq(getJobFamilyForLane("garbage"), []),
)

// ============================================================================

console.log("\n=== getLaneFromJobFamily (reverse) ===")

check(
  "Consulting → consulting",
  getLaneFromJobFamily("Consulting")?.id === "consulting",
)
check(
  "Finance → finance",
  getLaneFromJobFamily("Finance")?.id === "finance",
)
check(
  "Accounting → accounting",
  getLaneFromJobFamily("Accounting")?.id === "accounting",
)
check(
  "Marketing → marketing",
  getLaneFromJobFamily("Marketing")?.id === "marketing",
)
check(
  "Sales → sales_bd",
  getLaneFromJobFamily("Sales")?.id === "sales_bd",
)
check(
  "IT_Software → technology",
  getLaneFromJobFamily("IT_Software")?.id === "technology",
)
check(
  "Engineering → technology (with migration caveat)",
  getLaneFromJobFamily("Engineering")?.id === "technology",
)
check(
  "Operations → operations_strategy",
  getLaneFromJobFamily("Operations")?.id === "operations_strategy",
)
check(
  "Healthcare → healthcare",
  getLaneFromJobFamily("Healthcare")?.id === "healthcare",
)
check(
  "PreMed → healthcare (migration also sets status_premed)",
  getLaneFromJobFamily("PreMed")?.id === "healthcare",
)
check("HR → people_hr", getLaneFromJobFamily("HR")?.id === "people_hr")
check(
  "Government → public_sector",
  getLaneFromJobFamily("Government")?.id === "public_sector",
)
check("Legal → legal", getLaneFromJobFamily("Legal")?.id === "legal")
check("Other → other", getLaneFromJobFamily("Other")?.id === "other")
check(
  "Analytics → null (intentionally unmapped)",
  getLaneFromJobFamily("Analytics") === null,
)
check(
  "Trades → null (out of scope)",
  getLaneFromJobFamily("Trades") === null,
)

// ============================================================================

console.log("\n=== Forward+reverse round-trip consistency ===")

// For every (lane, family) pair in the forward table, reverse(family) should
// resolve back to that lane. (Because no family appears in more than one
// lane's mapping, this is a clean bidirectional invariant.)
for (const lane of LANES) {
  for (const family of lane.jobFamilyMapping) {
    const reversed = getLaneFromJobFamily(family)
    check(
      `${lane.id}.jobFamilyMapping includes ${family} ⇒ reverse(${family}) = ${lane.id}`,
      reversed?.id === lane.id,
      `reverse-mapped to ${reversed?.id ?? "null"}`,
    )
  }
}

// No JobFamily appears in more than one lane's mapping (clean partition).
const familyToLanes = new Map<string, string[]>()
for (const lane of LANES) {
  for (const family of lane.jobFamilyMapping) {
    const arr = familyToLanes.get(family) ?? []
    arr.push(lane.id)
    familyToLanes.set(family, arr)
  }
}
for (const [family, lanes] of familyToLanes.entries()) {
  check(
    `JobFamily ${family} appears in exactly one lane`,
    lanes.length === 1,
    `appears in ${lanes.join(", ")}`,
  )
}

// ============================================================================

console.log(`\n=== RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} ===`)
if (failures.length) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("All checks passed.")
