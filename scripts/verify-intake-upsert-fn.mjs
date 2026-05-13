// scripts/verify-intake-upsert-fn.mjs
//
// Read-only verification that intake_upsert_with_targeting exists and is
// callable on dev. Strategy:
//   1. Call with an all-zero UUID for p_profile_id and p_user_id. Function
//      tries to UPDATE client_profiles; matches zero rows; RAISEs
//      'profile_not_found_or_wrong_user'. We catch the error and confirm
//      it's the EXPECTED error (not "function does not exist" or signature
//      mismatch).
//   2. No writes happen — the function aborts before any side effects.
//
// Exits 1 on unexpected outcomes.

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const env = Object.fromEntries(
  readFileSync(".env.development.local", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=")
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

console.log(`Dev project: ${env.SUPABASE_URL}`)
console.log("\n=== Test: function exists, is callable, RAISEs on missing profile ===")

const ZERO_UUID = "00000000-0000-0000-0000-000000000000"

const { data, error } = await sb.rpc("intake_upsert_with_targeting", {
  p_profile_id: ZERO_UUID,
  p_user_id: ZERO_UUID,
  p_profile_payload: {
    name: "Verification Test",
    profile_text: "verification only",
    profile_complete: false,
  },
  // p_targeting_payload omitted — testing the no-targeting path too
})

if (data) {
  console.log(`  ✗ UNEXPECTED: function returned data: ${JSON.stringify(data)}`)
  console.log("     A profile with id=00000000... should not exist; function should have RAISEd")
  process.exit(1)
}

if (!error) {
  console.log("  ✗ UNEXPECTED: no error AND no data")
  process.exit(1)
}

// Expected error message: contains 'profile_not_found_or_wrong_user'
const msg = error.message ?? ""
if (msg.includes("profile_not_found_or_wrong_user")) {
  console.log(`  ✓ Function exists and RAISEs as designed:`)
  console.log(`     ${msg}`)
  console.log(`\n=== RESULT: PASS ===`)
  process.exit(0)
}

// Other errors mean something's wrong (signature mismatch, function missing, etc.)
console.log(`  ✗ Unexpected error:`)
console.log(`     code:    ${error.code}`)
console.log(`     message: ${error.message}`)
console.log(`     details: ${error.details}`)
console.log(`     hint:    ${error.hint}`)
console.log(`\n=== RESULT: FAIL ===`)
process.exit(1)
