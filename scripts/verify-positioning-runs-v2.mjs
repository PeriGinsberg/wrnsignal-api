// scripts/verify-positioning-runs-v2.mjs
//
// Functional smoke of positioning_runs_v2 on DEV. Exercises:
//   1. Required columns accept a valid INSERT (column existence proxy)
//   2. updated_at trigger fires on UPDATE (DD-07 set_updated_at)
//   3. CHECK constraints reject bad case_assigned / current_phase / status
//   4. FK constraint rejects bogus profile_id
//   5. result_json accepts a JSONB write on completion path
//
// Does NOT cover raw catalog inspection of indexes — Supabase JS client
// can't reach pg_indexes / pg_constraint / pg_trigger directly. Those four
// raw catalog queries should be run in Supabase SQL Editor and pasted.
//
// Cleans up via DELETE in finally. Exits 1 on any failure.

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
  console.log("\n=== Find a profile + persona to attach test row to ===")
  // ----------------------------------------------------------------------
  const { data: profiles, error: profileErr } = await sb
    .from("client_profiles")
    .select("id, email")
    .limit(1)
  if (profileErr || !profiles?.length) {
    fail("Could not find a client_profile", profileErr?.message ?? "no rows")
    throw new Error("Cannot continue without a profile")
  }
  const profileId = profiles[0].id
  console.log(`  profile_id ${profileId} (${profiles[0].email})`)

  const { data: personas, error: personaErr } = await sb
    .from("client_personas")
    .select("id")
    .eq("profile_id", profileId)
    .limit(1)
  if (personaErr || !personas?.length) {
    fail("Could not find a client_persona for this profile", personaErr?.message ?? "no rows")
    throw new Error("Cannot continue without a persona")
  }
  const personaId = personas[0].id
  console.log(`  persona_id ${personaId}`)

  // ----------------------------------------------------------------------
  console.log("\n=== Test 1: INSERT valid row (column existence proxy) ===")
  // ----------------------------------------------------------------------
  const insertPayload = {
    profile_id: profileId,
    persona_id: personaId,
    jobfit_run_id: null,
    signal_application_id: null,
    job_title: "[verify] Test PM",
    job_company: "[verify] Test Co",
    job_url: null,
    job_description: "[verify] smoke test row — should be deleted by this script",
    case_assigned: "B",
    case_reasoning: "smoke test",
    current_phase: 1,
    phase_data: { phase_1: { case_assigned_at: new Date().toISOString() } },
    status: "in_progress",
    fingerprint_hash: "verify-smoke-" + Date.now(),
    fingerprint_code: "p:verify|pn:smoke|jd:test|t:none",
    result_json: null,
  }

  const { data: inserted, error: insErr } = await sb
    .from("positioning_runs_v2")
    .insert(insertPayload)
    .select("id, created_at, updated_at, case_assigned, current_phase, status, phase_data")
    .single()

  if (insErr || !inserted) {
    fail("INSERT valid row", insErr?.message ?? "no row returned")
    throw new Error("Insert failed — cannot continue")
  }
  testRowId = inserted.id
  pass(`INSERT works: id=${inserted.id.slice(0, 8)}…  case=${inserted.case_assigned}  phase=${inserted.current_phase}  status=${inserted.status}`)
  pass(`Defaults applied: created_at=${inserted.created_at}  updated_at=${inserted.updated_at}`)
  if (inserted.created_at === inserted.updated_at) {
    pass("created_at === updated_at at insert (expected)")
  } else {
    fail("created_at != updated_at at insert", `c=${inserted.created_at} u=${inserted.updated_at}`)
  }

  // ----------------------------------------------------------------------
  console.log("\n=== Test 2: updated_at trigger fires on UPDATE ===")
  // ----------------------------------------------------------------------
  await new Promise((r) => setTimeout(r, 1100))

  const { data: updated, error: updErr } = await sb
    .from("positioning_runs_v2")
    .update({ case_reasoning: "smoke test (updated)" })
    .eq("id", testRowId)
    .select("id, created_at, updated_at")
    .single()

  if (updErr || !updated) {
    fail("UPDATE test row", updErr?.message ?? "no row returned")
  } else {
    const createdMs = Date.parse(updated.created_at)
    const updatedMs = Date.parse(updated.updated_at)
    if (updatedMs > createdMs) {
      pass(`Trigger fired: updated_at advanced by ${updatedMs - createdMs}ms`)
    } else {
      fail("Trigger did NOT advance updated_at", `c=${updated.created_at} u=${updated.updated_at}`)
    }
  }

  // ----------------------------------------------------------------------
  console.log("\n=== Test 3: CHECK constraints reject bad values ===")
  // ----------------------------------------------------------------------
  {
    const { error } = await sb
      .from("positioning_runs_v2")
      .update({ case_assigned: "Z" })
      .eq("id", testRowId)
    if (error) pass(`case_assigned='Z' rejected: ${error.message.split("\n")[0]}`)
    else fail("case_assigned='Z' was ACCEPTED — CHECK constraint missing?")
  }
  {
    const { error } = await sb
      .from("positioning_runs_v2")
      .update({ current_phase: 6 })
      .eq("id", testRowId)
    if (error) pass(`current_phase=6 rejected: ${error.message.split("\n")[0]}`)
    else fail("current_phase=6 was ACCEPTED — CHECK constraint missing?")
  }
  {
    const { error } = await sb
      .from("positioning_runs_v2")
      .update({ current_phase: 0 })
      .eq("id", testRowId)
    if (error) pass(`current_phase=0 rejected: ${error.message.split("\n")[0]}`)
    else fail("current_phase=0 was ACCEPTED — CHECK constraint missing?")
  }
  {
    const { error } = await sb
      .from("positioning_runs_v2")
      .update({ status: "foo" })
      .eq("id", testRowId)
    if (error) pass(`status='foo' rejected: ${error.message.split("\n")[0]}`)
    else fail("status='foo' was ACCEPTED — CHECK constraint missing?")
  }

  // ----------------------------------------------------------------------
  console.log("\n=== Test 4: FK constraint rejects bogus profile_id ===")
  // ----------------------------------------------------------------------
  {
    const { error } = await sb
      .from("positioning_runs_v2")
      .insert({
        ...insertPayload,
        profile_id: "00000000-0000-0000-0000-000000000000",
        fingerprint_hash: "verify-fk-" + Date.now(),
      })
    if (error) pass(`bogus profile_id rejected: ${error.message.split("\n")[0]}`)
    else fail("bogus profile_id was ACCEPTED — FK constraint missing?")
  }

  // ----------------------------------------------------------------------
  console.log("\n=== Test 5: result_json + completed_at path accepts JSONB ===")
  // ----------------------------------------------------------------------
  {
    const { data, error } = await sb
      .from("positioning_runs_v2")
      .update({
        status: "completed",
        result_json: { case: "B", case_specific: null, completed_at_smoke: true },
        completed_at: new Date().toISOString(),
      })
      .eq("id", testRowId)
      .select("id, status, result_json, completed_at")
      .single()
    if (error || !data) fail("status='completed' + result_json UPDATE", error?.message ?? "no row")
    else pass(`completed path works: status=${data.status} result_json keys=${Object.keys(data.result_json ?? {}).join(",")} completed_at=${data.completed_at}`)
  }
} catch (e) {
  console.error(`\nFatal: ${e.message}`)
} finally {
  // ----------------------------------------------------------------------
  if (testRowId) {
    console.log("\n=== Cleanup ===")
    const { error } = await sb
      .from("positioning_runs_v2")
      .delete()
      .eq("id", testRowId)
    if (error) {
      console.log(`  ✗ FAILED to delete test row ${testRowId}: ${error.message}`)
      console.log(`     MANUAL CLEANUP: DELETE FROM public.positioning_runs_v2 WHERE id = '${testRowId}';`)
      failed++
    } else {
      console.log(`  ✓ Test row ${testRowId.slice(0, 8)}… deleted`)
    }
  }
}

console.log(`\n=== RESULT: ${failed === 0 ? "PASS" : "FAIL"} ===`)
if (failed > 0) process.exit(1)
