// tests/candidate-targeting/derive-career-stage-check.ts
//
// Pure-function unit checks for deriveCareerStage in lib/candidateTargeting.ts.
// No DB, no LLM, no I/O.
//
// Run:
//   npx tsx tests/candidate-targeting/derive-career-stage-check.ts
//
// Exits 1 on any failure.

import { deriveCareerStage } from "@/lib/candidateTargeting"
import type { CareerStage } from "@/lib/laneTaxonomy"

const failures: string[] = []

function check(
  name: string,
  got: CareerStage,
  expected: CareerStage,
): void {
  if (got === expected) {
    console.log(`  ✓ ${name}: ${got}`)
  } else {
    failures.push(`${name}: expected ${expected}, got ${got}`)
    console.log(`  ✗ ${name}: expected ${expected}, got ${got}`)
  }
}

console.log("=== Self-identification trumps inference ===")
// Per FRD section 4.4: "Current student" → student regardless of years.
check("Current student + null years", deriveCareerStage({ currentStatus: "Current student", yearsExperienceApprox: null }), "student")
check("Current student + 0 years",    deriveCareerStage({ currentStatus: "Current student", yearsExperienceApprox: 0 }), "student")
check("Current student + 20 years",   deriveCareerStage({ currentStatus: "Current student", yearsExperienceApprox: 20 }), "student")

console.log("\n=== Recent graduate ===")
check("Recent graduate + null years", deriveCareerStage({ currentStatus: "Recent graduate", yearsExperienceApprox: null }), "early_career")
check("Recent graduate + 0 years",    deriveCareerStage({ currentStatus: "Recent graduate", yearsExperienceApprox: 0 }), "early_career")
check("Recent graduate + 5 years",    deriveCareerStage({ currentStatus: "Recent graduate", yearsExperienceApprox: 5 }), "early_career")

console.log("\n=== Working professional: year buckets ===")
check("Working professional + null years",     deriveCareerStage({ currentStatus: "Working professional", yearsExperienceApprox: null }), "mid_career")
check("Working professional + undefined years", deriveCareerStage({ currentStatus: "Working professional", yearsExperienceApprox: undefined }), "mid_career")
check("Working professional + 0 years",        deriveCareerStage({ currentStatus: "Working professional", yearsExperienceApprox: 0 }), "early_career")
check("Working professional + 1 year",         deriveCareerStage({ currentStatus: "Working professional", yearsExperienceApprox: 1 }), "early_career")
check("Working professional + 2 years (boundary)", deriveCareerStage({ currentStatus: "Working professional", yearsExperienceApprox: 2 }), "early_career")
check("Working professional + 3 years",        deriveCareerStage({ currentStatus: "Working professional", yearsExperienceApprox: 3 }), "mid_career")
check("Working professional + 10 years",       deriveCareerStage({ currentStatus: "Working professional", yearsExperienceApprox: 10 }), "mid_career")
check("Working professional + 15 years (boundary)", deriveCareerStage({ currentStatus: "Working professional", yearsExperienceApprox: 15 }), "mid_career")
check("Working professional + 16 years",       deriveCareerStage({ currentStatus: "Working professional", yearsExperienceApprox: 16 }), "executive")
check("Working professional + 30 years",       deriveCareerStage({ currentStatus: "Working professional", yearsExperienceApprox: 30 }), "executive")

console.log("\n=== Career pivot: same buckets as working professional ===")
check("Career pivot + null years",  deriveCareerStage({ currentStatus: "Career pivot", yearsExperienceApprox: null }), "mid_career")
check("Career pivot + 2 years",     deriveCareerStage({ currentStatus: "Career pivot", yearsExperienceApprox: 2 }), "early_career")
check("Career pivot + 8 years",     deriveCareerStage({ currentStatus: "Career pivot", yearsExperienceApprox: 8 }), "mid_career")
check("Career pivot + 20 years",    deriveCareerStage({ currentStatus: "Career pivot", yearsExperienceApprox: 20 }), "executive")

console.log("\n=== Case insensitivity (per Friction 4) ===")
check("'current student' (lowercase)",       deriveCareerStage({ currentStatus: "current student", yearsExperienceApprox: null }), "student")
check("'CURRENT STUDENT' (uppercase)",       deriveCareerStage({ currentStatus: "CURRENT STUDENT", yearsExperienceApprox: null }), "student")
check("'Current Student' (mixed)",           deriveCareerStage({ currentStatus: "Current Student", yearsExperienceApprox: null }), "student")
check("'  Recent graduate  ' (whitespace)",  deriveCareerStage({ currentStatus: "  Recent graduate  ", yearsExperienceApprox: null }), "early_career")
check("'Working Professional' (title case)", deriveCareerStage({ currentStatus: "Working Professional", yearsExperienceApprox: 10 }), "mid_career")

console.log("\n=== Empty / unrecognized status → mid_career fallback ===")
check("empty string",                deriveCareerStage({ currentStatus: "", yearsExperienceApprox: 5 }), "mid_career")
check("null status",                 deriveCareerStage({ currentStatus: null, yearsExperienceApprox: 5 }), "mid_career")
check("undefined status",            deriveCareerStage({ currentStatus: undefined, yearsExperienceApprox: 5 }), "mid_career")
check("unrecognized status string",  deriveCareerStage({ currentStatus: "Freelancer", yearsExperienceApprox: 5 }), "mid_career")
check("null status + null years",    deriveCareerStage({ currentStatus: null, yearsExperienceApprox: null }), "mid_career")

console.log(`\n=== RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} ===`)
if (failures.length) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("All checks passed.")
