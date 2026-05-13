// scripts/verify-foundation-stage-1a.mjs
//
// Read-only-ish verification of Foundation Stage 1a migrations on DEV.
//   1. candidate_targeting table exists and accepts SELECT
//   2. signal_applications has positioning_run_id and coverletter_run_id
//   3. updated_at trigger fires on UPDATE (insert test row, update, verify
//      updated_at advanced, DELETE test row)
//
// Pulls SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.development.local.
// Exits 1 on any failure. Does NOT leave test data behind (DELETE in finally).

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

let testRowId = null
let failed = 0

function pass(msg) { console.log(`  ✓ ${msg}`) }
function fail(msg, detail) {
  failed++
  console.log(`  ✗ ${msg}${detail ? ` — ${detail}` : ""}`)
}

console.log(`Dev project: ${env.SUPABASE_URL}`)

try {
  // ----------------------------------------------------------------------
  console.log("\n=== Test 1: candidate_targeting SELECT (table exists) ===")
  // ----------------------------------------------------------------------
  {
    const { data, error } = await sb
      .from("candidate_targeting")
      .select("id")
      .limit(1)
    if (error) {
      fail("SELECT from candidate_targeting", error.message)
    } else {
      pass(`SELECT works (returned ${data?.length ?? 0} rows)`)
    }
  }

  // ----------------------------------------------------------------------
  console.log("\n=== Test 2: signal_applications new columns ===")
  // ----------------------------------------------------------------------
  {
    const { data, error } = await sb
      .from("signal_applications")
      .select("id, jobfit_run_id, positioning_run_id, coverletter_run_id")
      .limit(1)
    if (error) {
      fail("SELECT signal_applications new columns", error.message)
    } else {
      pass(
        `SELECT positioning_run_id + coverletter_run_id works (returned ${data?.length ?? 0} rows)`,
      )
    }
  }

  // ----------------------------------------------------------------------
  console.log("\n=== Test 3: trigger fires on UPDATE ===")
  // ----------------------------------------------------------------------
  // Need a real client_profile id (FK target).
  const { data: profiles, error: profileErr } = await sb
    .from("client_profiles")
    .select("id, email")
    .limit(1)
  if (profileErr || !profiles?.length) {
    fail("Could not find a client_profile to attach test row to", profileErr?.message ?? "no rows")
    throw new Error("Cannot run trigger test without a profile")
  }
  const profileId = profiles[0].id
  console.log(`  using profile_id ${profileId} (${profiles[0].email}) for test row`)

  // Make sure no existing targeting row for this profile (would block insert due to UNIQUE)
  const { data: existing } = await sb
    .from("candidate_targeting")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle()
  if (existing) {
    fail(
      `profile ${profileId} already has a targeting row (${existing.id}) — abort, would conflict with UNIQUE`,
    )
    throw new Error("Aborting trigger test")
  }

  // INSERT
  const { data: inserted, error: insErr } = await sb
    .from("candidate_targeting")
    .insert({
      profile_id: profileId,
      primary_lane: "technology",
      primary_sublane: "software_engineering",
      career_stage: "mid_career",
      career_stage_locked_by: "inferred",
      source: "intake", // not migration, but it's a test row
      status_premed: false,
      status_prelaw: false,
      status_pregrad: false,
    })
    .select("id, created_at, updated_at")
    .single()

  if (insErr || !inserted) {
    fail("INSERT test row", insErr?.message ?? "no row returned")
    throw new Error("Insert failed")
  }
  testRowId = inserted.id
  pass(
    `INSERT works: id=${inserted.id.slice(0, 8)}…  created_at=${inserted.created_at}  updated_at=${inserted.updated_at}`,
  )

  if (inserted.created_at !== inserted.updated_at) {
    fail("created_at == updated_at at insert time", `created=${inserted.created_at} updated=${inserted.updated_at}`)
  } else {
    pass("created_at === updated_at at insert (expected)")
  }

  // Wait a moment so the trigger's now() will be observably later.
  await new Promise((r) => setTimeout(r, 1100))

  // UPDATE — touch a benign field
  const { data: updated, error: updErr } = await sb
    .from("candidate_targeting")
    .update({ primary_sublane: "data_science" })
    .eq("id", testRowId)
    .select("id, created_at, updated_at, primary_sublane")
    .single()

  if (updErr || !updated) {
    fail("UPDATE test row", updErr?.message ?? "no row returned")
    throw new Error("Update failed")
  }
  pass(
    `UPDATE works: primary_sublane=${updated.primary_sublane}  created_at=${updated.created_at}  updated_at=${updated.updated_at}`,
  )

  const createdMs = Date.parse(updated.created_at)
  const updatedMs = Date.parse(updated.updated_at)
  if (updatedMs > createdMs) {
    pass(`Trigger fired: updated_at advanced by ${updatedMs - createdMs}ms over created_at`)
  } else {
    fail(
      "Trigger did NOT advance updated_at",
      `created=${updated.created_at} updated=${updated.updated_at}`,
    )
  }

  // ----------------------------------------------------------------------
  // CHECK CONSTRAINT smoke (one bad value to confirm CHECK is active)
  // ----------------------------------------------------------------------
  console.log("\n=== Test 4: CHECK constraint smoke ===")
  {
    const { error: badErr } = await sb
      .from("candidate_targeting")
      .update({ primary_lane: "not_a_real_lane" })
      .eq("id", testRowId)
    if (badErr) {
      pass(`Bad primary_lane rejected by CHECK: ${badErr.message}`)
    } else {
      fail("Bad primary_lane was ACCEPTED — CHECK constraint not active?")
    }
  }
} catch (e) {
  console.error(`\nFatal: ${e.message}`)
} finally {
  // ----------------------------------------------------------------------
  // ALWAYS clean up the test row
  // ----------------------------------------------------------------------
  if (testRowId) {
    console.log("\n=== Cleanup ===")
    const { error: delErr } = await sb
      .from("candidate_targeting")
      .delete()
      .eq("id", testRowId)
    if (delErr) {
      console.log(`  ✗ FAILED to delete test row ${testRowId}: ${delErr.message}`)
      console.log(`     MANUAL CLEANUP REQUIRED: DELETE FROM public.candidate_targeting WHERE id = '${testRowId}';`)
      failed++
    } else {
      console.log(`  ✓ Test row ${testRowId.slice(0, 8)}… deleted`)
    }
  }
}

console.log(`\n=== RESULT: ${failed === 0 ? "PASS" : "FAIL"} ===`)
if (failed > 0) process.exit(1)
