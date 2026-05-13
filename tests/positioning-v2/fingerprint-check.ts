// tests/positioning-v2/fingerprint-check.ts
//
// Unit checks for lib/positioning/v2/fingerprint.ts. Pure function,
// no DB / LLM / I/O.
//
// Run:
//   npx tsx tests/positioning-v2/fingerprint-check.ts
//
// Exits 1 on any failure.

import { computeFingerprint } from "@/lib/positioning/v2/fingerprint"
import type { FingerprintInputs } from "@/lib/positioning/v2/types"

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

// Base case used by most tests. Helpers can override fields.
function makeInputs(overrides: Partial<FingerprintInputs> = {}): FingerprintInputs {
  return {
    profileId: "11111111-1111-4111-a111-111111111111",
    personaId: "22222222-2222-4222-a222-222222222222",
    jobTitle: "Senior Product Manager",
    jobCompany: "Acme Corp",
    jobDescription: "We are looking for a Senior PM to lead our growth team.",
    targeting: {
      primary_lane: "technology",
      primary_sublane: "product_management",
      status_premed: false,
      status_prelaw: false,
      status_pregrad: false,
    },
    careerStage: "mid_career",
    ...overrides,
  }
}

// ============================================================================
// Determinism
// ============================================================================

console.log("=== Determinism ===")

// Test 1: Same inputs produce same fingerprint
{
  const a = computeFingerprint(makeInputs())
  const b = computeFingerprint(makeInputs())
  check("1: same inputs → same hash", a.hash === b.hash, `${a.hash} vs ${b.hash}`)
  check("1: same inputs → same code", a.code === b.code, `${a.code} vs ${b.code}`)
}

// Test 2: Input key order doesn't affect output (canonical JSON)
//   We build two inputs objects with property assignment in different orders;
//   canonical JSON serialization should normalize them.
{
  const inputs1: FingerprintInputs = {
    profileId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    personaId: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    jobTitle: "Eng",
    jobCompany: "Co",
    jobDescription: "Desc",
    targeting: {
      primary_lane: "technology",
      primary_sublane: null,
      status_premed: false,
      status_prelaw: false,
      status_pregrad: false,
    },
    careerStage: "mid_career",
  }
  // Same content, intentionally constructed differently to ensure no
  // accidental reliance on property iteration order
  const inputs2: FingerprintInputs = {
    careerStage: "mid_career",
    targeting: {
      status_pregrad: false,
      status_prelaw: false,
      status_premed: false,
      primary_sublane: null,
      primary_lane: "technology",
    },
    jobDescription: "Desc",
    jobCompany: "Co",
    jobTitle: "Eng",
    personaId: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    profileId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  }
  const a = computeFingerprint(inputs1)
  const b = computeFingerprint(inputs2)
  check("2: key order doesn't affect hash", a.hash === b.hash)
  check("2: key order doesn't affect code", a.code === b.code)
}

// ============================================================================
// Input sensitivity (each field, change → different hash)
// ============================================================================

console.log("\n=== Each field affects the hash ===")

const baseline = computeFingerprint(makeInputs())

// Test 3: profileId change
{
  const r = computeFingerprint(
    makeInputs({ profileId: "99999999-9999-4999-a999-999999999999" }),
  )
  check("3: profileId change → different hash", r.hash !== baseline.hash)
  check("3: profileId change → different code", r.code !== baseline.code)
  check(
    "3: code starts with p:99999999",
    r.code.startsWith("p:99999999"),
    r.code,
  )
}

// Test 4: personaId change
{
  const r = computeFingerprint(
    makeInputs({ personaId: "88888888-8888-4888-a888-888888888888" }),
  )
  check("4: personaId change → different hash", r.hash !== baseline.hash)
  check(
    "4: code contains pn:88888888",
    r.code.includes("|pn:88888888|"),
    r.code,
  )
}

// Test 5: jobTitle change
{
  const r = computeFingerprint(makeInputs({ jobTitle: "Marketing Director" }))
  check("5: jobTitle change → different hash", r.hash !== baseline.hash)
}

// Test 6: jobCompany change
{
  const r = computeFingerprint(makeInputs({ jobCompany: "Other Inc" }))
  check("6: jobCompany change → different hash", r.hash !== baseline.hash)
}

// Test 7: jobDescription change
{
  const r = computeFingerprint(
    makeInputs({ jobDescription: "Completely different JD content." }),
  )
  check("7: jobDescription change → different hash", r.hash !== baseline.hash)
}

// Test 8: primary_lane change
{
  const r = computeFingerprint(
    makeInputs({
      targeting: {
        primary_lane: "marketing", // changed from technology
        primary_sublane: "product_management",
        status_premed: false,
        status_prelaw: false,
        status_pregrad: false,
      },
    }),
  )
  check("8: primary_lane change → different hash", r.hash !== baseline.hash)
}

// Test 8b: primary_sublane change
{
  const r = computeFingerprint(
    makeInputs({
      targeting: {
        primary_lane: "technology",
        primary_sublane: "engineering_management", // changed
        status_premed: false,
        status_prelaw: false,
        status_pregrad: false,
      },
    }),
  )
  check("8b: primary_sublane change → different hash", r.hash !== baseline.hash)
}

// Test 8c: status_premed flip
{
  const r = computeFingerprint(
    makeInputs({
      targeting: {
        primary_lane: "technology",
        primary_sublane: "product_management",
        status_premed: true, // flipped
        status_prelaw: false,
        status_pregrad: false,
      },
    }),
  )
  check("8c: status_premed flip → different hash", r.hash !== baseline.hash)
}

// Test 8d: status_prelaw flip
{
  const r = computeFingerprint(
    makeInputs({
      targeting: {
        primary_lane: "technology",
        primary_sublane: "product_management",
        status_premed: false,
        status_prelaw: true, // flipped
        status_pregrad: false,
      },
    }),
  )
  check("8d: status_prelaw flip → different hash", r.hash !== baseline.hash)
}

// Test 8e: status_pregrad flip
{
  const r = computeFingerprint(
    makeInputs({
      targeting: {
        primary_lane: "technology",
        primary_sublane: "product_management",
        status_premed: false,
        status_prelaw: false,
        status_pregrad: true, // flipped
      },
    }),
  )
  check("8e: status_pregrad flip → different hash", r.hash !== baseline.hash)
}

// Test 9: careerStage change (with same targeting)
{
  const r = computeFingerprint(makeInputs({ careerStage: "executive" }))
  check("9: careerStage change → different hash", r.hash !== baseline.hash)
}

// ============================================================================
// Null targeting
// ============================================================================

console.log("\n=== Null targeting ===")

// Test 10: Null targeting produces a valid hash
{
  const r = computeFingerprint(makeInputs({ targeting: null }))
  check("10: null targeting → 64-char hex hash", /^[0-9a-f]{64}$/.test(r.hash))
  check("10: null targeting → valid code format", /^p:[0-9a-f]{8}\|pn:[0-9a-f]{8}\|jd:[0-9a-f]{8}\|t:[0-9a-f]{8}$/.test(r.code), r.code)
}

// Test 10b: Null targeting is distinguishable from any real targeting state
{
  const nullR = computeFingerprint(makeInputs({ targeting: null }))
  const allFalseR = computeFingerprint(
    makeInputs({
      targeting: {
        primary_lane: "", // can't actually be empty in schema, but checks
        primary_sublane: null,
        status_premed: false,
        status_prelaw: false,
        status_pregrad: false,
      },
    }),
  )
  check(
    "10b: null targeting ≠ targeting with all-default values",
    nullR.hash !== allFalseR.hash,
  )
}

// Test 10c: careerStage still affects hash when targeting is null
{
  const nullMid = computeFingerprint(
    makeInputs({ targeting: null, careerStage: "mid_career" }),
  )
  const nullExec = computeFingerprint(
    makeInputs({ targeting: null, careerStage: "executive" }),
  )
  check(
    "10c: careerStage affects hash even when targeting is null",
    nullMid.hash !== nullExec.hash,
  )
}

// ============================================================================
// JD normalization
// ============================================================================

console.log("\n=== JD normalization ===")

// Test 11: Whitespace at edges of JD components is ignored
{
  const a = computeFingerprint(
    makeInputs({
      jobTitle: "  Senior PM  ",
      jobCompany: "\tAcme Corp\n",
      jobDescription: "  the job  ",
    }),
  )
  const b = computeFingerprint(
    makeInputs({
      jobTitle: "Senior PM",
      jobCompany: "Acme Corp",
      jobDescription: "the job",
    }),
  )
  check("11: edge whitespace doesn't affect hash", a.hash === b.hash)
}

// Test 12: Case differences in JD components are normalized
{
  const a = computeFingerprint(
    makeInputs({
      jobTitle: "SENIOR pm",
      jobCompany: "Acme CORP",
      jobDescription: "THE Job",
    }),
  )
  const b = computeFingerprint(
    makeInputs({
      jobTitle: "senior pm",
      jobCompany: "acme corp",
      jobDescription: "the job",
    }),
  )
  check("12: case differences normalized", a.hash === b.hash)
}

// Test 13: Internal whitespace IS significant (not collapsed)
{
  const single = computeFingerprint(makeInputs({ jobTitle: "Senior PM" }))
  const doubled = computeFingerprint(makeInputs({ jobTitle: "Senior  PM" })) // 2 spaces inside
  check(
    "13: internal whitespace difference → different hash (not collapsed)",
    single.hash !== doubled.hash,
  )
}

// Test 13b: Substring-only differences in JD body → different hash
{
  const a = computeFingerprint(makeInputs({ jobDescription: "We need Python." }))
  const b = computeFingerprint(makeInputs({ jobDescription: "We need Pythonn." }))
  check("13b: 1-char JD difference → different hash", a.hash !== b.hash)
}

// ============================================================================
// Code format
// ============================================================================

console.log("\n=== Code format ===")

// Test 14: code has expected structure
{
  const r = computeFingerprint(makeInputs())
  check(
    "14: code matches p:xxxxxxxx|pn:xxxxxxxx|jd:xxxxxxxx|t:xxxxxxxx",
    /^p:[0-9a-f]{8}\|pn:[0-9a-f]{8}\|jd:[0-9a-f]{8}\|t:[0-9a-f]{8}$/.test(r.code),
    r.code,
  )
  check(
    "14: code profileId prefix matches input prefix",
    r.code.startsWith("p:11111111"),
    r.code,
  )
  check(
    "14: code personaId segment matches input prefix",
    r.code.includes("|pn:22222222|"),
    r.code,
  )
}

// Test 15: hash is 64-char hex (sha256)
{
  const r = computeFingerprint(makeInputs())
  check("15: hash is 64-char hex", /^[0-9a-f]{64}$/.test(r.hash), `len=${r.hash.length}`)
}

// Test 16: code parts are all 8 lowercase hex chars
{
  const r = computeFingerprint(makeInputs())
  const segments = r.code.split("|")
  check("16: code has 4 segments", segments.length === 4)
  check(
    "16: each segment is prefix:8-char-hex",
    segments.every((s) => /^(p|pn|jd|t):[0-9a-f]{8}$/.test(s)),
    r.code,
  )
}

// ============================================================================
// Cross-field interactions
// ============================================================================

console.log("\n=== Cross-field interactions ===")

// Test 17: Two changes produce different hash than either alone
{
  const baseR = computeFingerprint(makeInputs())
  const profileOnly = computeFingerprint(
    makeInputs({ profileId: "99999999-9999-4999-a999-999999999999" }),
  )
  const stageOnly = computeFingerprint(makeInputs({ careerStage: "executive" }))
  const both = computeFingerprint(
    makeInputs({
      profileId: "99999999-9999-4999-a999-999999999999",
      careerStage: "executive",
    }),
  )
  check("17: both changes ≠ baseline", both.hash !== baseR.hash)
  check("17: both changes ≠ profile-only", both.hash !== profileOnly.hash)
  check("17: both changes ≠ stage-only", both.hash !== stageOnly.hash)
}

// Test 18: Same JD content with extra trailing whitespace in different places
//   still collapses to same hash (each field trim-edges only)
{
  const a = computeFingerprint(
    makeInputs({
      jobTitle: " a ",
      jobCompany: " b ",
      jobDescription: " c ",
    }),
  )
  const b = computeFingerprint(
    makeInputs({
      jobTitle: "a",
      jobCompany: "b",
      jobDescription: "c",
    }),
  )
  check("18: per-field trim equivalent on all three", a.hash === b.hash)
}

// ============================================================================
// Edge cases
// ============================================================================

console.log("\n=== Edge cases ===")

// Test 19: Empty JD components are accepted (validation happens upstream)
{
  const r = computeFingerprint(
    makeInputs({
      jobTitle: "",
      jobCompany: "",
      jobDescription: "",
    }),
  )
  check("19: empty JD inputs → valid 64-char hash", /^[0-9a-f]{64}$/.test(r.hash))
}

// Test 20: Empty profileId / personaId still produce a hash (validation is upstream)
{
  const r = computeFingerprint(
    makeInputs({ profileId: "", personaId: "" }),
  )
  check("20: empty ids → valid hash", /^[0-9a-f]{64}$/.test(r.hash))
  check(
    "20: empty ids → code has empty short segments",
    r.code === "p:|pn:|jd:" + r.code.split("|jd:")[1],
    r.code,
  )
}

// Test 21: targeting.primary_sublane null vs empty string → different hash
//   (null is a real schema state, "" is not — distinguishable)
{
  const aNull = computeFingerprint(
    makeInputs({
      targeting: {
        primary_lane: "technology",
        primary_sublane: null,
        status_premed: false,
        status_prelaw: false,
        status_pregrad: false,
      },
    }),
  )
  const aEmpty = computeFingerprint(
    makeInputs({
      targeting: {
        primary_lane: "technology",
        primary_sublane: "",
        status_premed: false,
        status_prelaw: false,
        status_pregrad: false,
      },
    }),
  )
  check(
    "21: sublane null vs empty string → different hash",
    aNull.hash !== aEmpty.hash,
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
