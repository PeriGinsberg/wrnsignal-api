#!/usr/bin/env tsx
// Tests for inferTargetFamilies. The prod regression corpus freezes
// profileOverrides.targetFamilies, so it cannot catch drift here; this file is
// the guard. Run:
//   npx tsx lib/jobfit-family-inference.test.ts

import { inferTargetFamilies } from "./jobfit-family-inference"

let pass = 0
let fail = 0
function expect(roles: string, want: string[]) {
  const got = inferTargetFamilies(roles, "")
  const ok = JSON.stringify([...got].sort()) === JSON.stringify([...want].sort())
  if (ok) pass++
  else fail++
  console.log(`${ok ? "✓" : "✗"} ${JSON.stringify(roles)} → ${JSON.stringify(got)}${ok ? "" : `  (want ${JSON.stringify(want)})`}`)
}

// Bare / generic engineer → Engineering (C003: "Engineer" resolved to ["Other"]
// and GATE_FIELD_MISMATCH force-passed a BSME on a Mechanical Engineer I role).
expect("Engineer", ["Engineering"])
expect("Engineering", ["Engineering"])
expect("Design Engineer", ["Engineering"])
expect("Analyst, Engineer", ["Engineering"])
expect("Mechanical Engineer", ["Engineering"])
expect("systems engineer, test engineer, controls engineer", ["Engineering"])

// Software / data / sales-type engineers must NOT gain Engineering.
expect("Software Engineer", ["IT_Software"])
expect("Software Engineering", ["IT_Software"])
expect("Data Engineer", ["IT_Software"])
expect("Machine Learning Engineer", ["IT_Software"])
expect("Sales Engineer", ["Sales"])
expect("Data Science, Data Engineer, Data Analyst, Machine Learning Engineer", ["Analytics", "IT_Software"])

// Genuinely unmapped non-technical targets stay "Other" so GATE_FIELD_MISMATCH
// still catches e.g. a psychology grad on a SWE role (core case 0410q).
expect("psychology research assistant, mental health counselor, clinical psychology trainee", ["Other"])

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
