// tests/positioning-v2/run-lookup-check.ts
//
// Integration smoke for lib/positioning/v2/runLookup.ts on DEV.
// Creates a signal_application + jobfit_run fixture pair, then per-test
// inserts and deletes positioning_runs_v2 rows with controlled (status,
// fingerprint, created_at) values to exercise the cascade.
//
// Run:
//   npx tsx tests/positioning-v2/run-lookup-check.ts
//
// Exits 1 on any failure. Pulls SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// from .env.development.local.

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { findExistingPositioningRun } from "@/lib/positioning/v2/runLookup"

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

const TS = Date.now()
const TEST_COMPANY = `[verify-runlookup] Co ${TS}`
const TEST_TITLE = `[verify-runlookup] Title ${TS}`

let testProfileId: string = ""
let testPersonaId: string = ""
let testAppId: string = ""
let testJobfitRunId: string = ""

const failures: string[] = []
function pass(m: string): void {
  console.log(`  ✓ ${m}`)
}
function fail(m: string, d?: string): void {
  failures.push(m)
  console.log(`  ✗ ${m}${d ? ` — ${d}` : ""}`)
}

// Helper to insert a positioning_runs_v2 fixture with controlled fields.
async function insertRun(opts: {
  status: "in_progress" | "completed" | "abandoned"
  fingerprintHash: string
  createdAtOffsetMs?: number // negative = earlier than now
}): Promise<string> {
  const ts = Date.now() + (opts.createdAtOffsetMs ?? 0)
  const { data, error } = await sb
    .from("positioning_runs_v2")
    .insert({
      profile_id: testProfileId,
      persona_id: testPersonaId,
      jobfit_run_id: testJobfitRunId,
      job_title: TEST_TITLE,
      job_company: TEST_COMPANY,
      job_description: "[verify-runlookup] body",
      case_assigned: "B",
      case_reasoning: "test fixture",
      current_phase: 1,
      phase_data: {},
      status: opts.status,
      fingerprint_hash: opts.fingerprintHash,
      fingerprint_code: `verify|runlookup|${opts.status}`,
      created_at: new Date(ts).toISOString(),
    })
    .select("id")
    .single()
  if (error || !data) {
    throw new Error(`insertRun failed: ${error?.message ?? "no row"}`)
  }
  return data.id
}

async function deleteRuns(ids: string[]): Promise<void> {
  for (const id of ids) {
    const { error } = await sb.from("positioning_runs_v2").delete().eq("id", id)
    if (error) {
      console.log(`  ⚠ failed to delete positioning_run ${id}: ${error.message}`)
      failures.push(`cleanup-positioning-run-${id}`)
    }
  }
}

console.log(`Dev project: ${env.SUPABASE_URL}`)

async function main(): Promise<void> {
 try {
  // ────────────────────────────────────────────────────────────────────────
  // Find a test profile + persona. Uses whichever profile+persona Supabase
  // returns first — D2 followed the same convention. Tests are agnostic to
  // which specific profile is used.
  // ────────────────────────────────────────────────────────────────────────
  const { data: profiles, error: profErr } = await sb
    .from("client_profiles")
    .select("id, email")
    .limit(10)
  if (profErr || !profiles?.length) {
    throw new Error(`Could not find a client_profile: ${profErr?.message ?? "no rows"}`)
  }

  // Find a profile that has a persona (positioning_runs_v2.persona_id is NOT NULL)
  let chosenProfile: { id: string; email: string } | null = null
  let chosenPersonaId: string | null = null
  for (const p of profiles) {
    const { data: personas } = await sb
      .from("client_personas")
      .select("id")
      .eq("profile_id", p.id)
      .limit(1)
    if (personas?.length) {
      chosenProfile = p
      chosenPersonaId = personas[0].id
      break
    }
  }
  if (!chosenProfile || !chosenPersonaId) {
    throw new Error("Could not find a profile with at least one persona")
  }
  testProfileId = chosenProfile.id
  testPersonaId = chosenPersonaId
  console.log(`  using profile ${testProfileId} (${chosenProfile.email}) with persona ${testPersonaId}`)

  // ────────────────────────────────────────────────────────────────────────
  // Create signal_application + jobfit_run fixture pair
  // ────────────────────────────────────────────────────────────────────────
  const { data: app, error: appErr } = await sb
    .from("signal_applications")
    .insert({
      profile_id: testProfileId,
      company_name: TEST_COMPANY,
      job_title: TEST_TITLE,
      location: "",
      job_url: "",
      application_status: "saved",
      interest_level: 1,
    })
    .select("id")
    .single()
  if (appErr || !app) {
    throw new Error(`Test signal_app insert failed: ${appErr?.message ?? "no row"}`)
  }
  testAppId = app.id

  const { data: jr, error: jrErr } = await sb
    .from("jobfit_runs")
    .insert({
      client_profile_id: testProfileId,
      application_id: testAppId,
      fingerprint_hash: `verify-runlookup-${TS}`,
      fingerprint_code: `verify|runlookup|jobfit`,
      verdict: "Apply",
      result_json: { decision: "Apply", score: 75 },
    })
    .select("id")
    .single()
  if (jrErr || !jr) {
    throw new Error(`Test jobfit_run insert failed: ${jrErr?.message ?? "no row"}`)
  }
  testJobfitRunId = jr.id
  console.log(`  created signal_app ${testAppId?.slice(0, 8)}… + jobfit_run ${testJobfitRunId.slice(0, 8)}…`)

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n=== Cascade outcomes ===")
  // ════════════════════════════════════════════════════════════════════════

  // Test 1: No existing positioning_runs_v2 rows → outcome='new'
  {
    const r = await findExistingPositioningRun(
      sb,
      testProfileId,
      testPersonaId,
      testJobfitRunId,
      "fp_anything",
    )
    if (r.outcome !== "new") fail("1: no rows → outcome=new", r.outcome)
    else if (r.row !== null) fail("1: no rows → row=null", String(r.row))
    else pass("1: no existing rows returns outcome=new")
  }

  // Test 2: Only in_progress row → outcome='resume'
  {
    const id = await insertRun({ status: "in_progress", fingerprintHash: "fp_inprog" })
    const r = await findExistingPositioningRun(
      sb,
      testProfileId,
      testPersonaId,
      testJobfitRunId,
      "fp_inprog",
    )
    if (r.outcome !== "resume") fail("2: in_progress → outcome=resume", r.outcome)
    else if (r.row?.id !== id) fail("2: returns the in_progress row", `got ${r.row?.id}`)
    else pass("2: only in_progress row returns outcome=resume")
    await deleteRuns([id])
  }

  // Test 3: Only completed + matching fingerprint → outcome='cache_hit'
  {
    const id = await insertRun({ status: "completed", fingerprintHash: "fp_match" })
    const r = await findExistingPositioningRun(
      sb,
      testProfileId,
      testPersonaId,
      testJobfitRunId,
      "fp_match",
    )
    if (r.outcome !== "cache_hit") fail("3: completed+match → outcome=cache_hit", r.outcome)
    else if (r.row?.id !== id) fail("3: returns the completed row", `got ${r.row?.id}`)
    else pass("3: completed with matching fingerprint returns outcome=cache_hit")
    await deleteRuns([id])
  }

  // Test 4: Only completed + mismatched fingerprint → outcome='new'
  {
    const id = await insertRun({ status: "completed", fingerprintHash: "fp_actual" })
    const r = await findExistingPositioningRun(
      sb,
      testProfileId,
      testPersonaId,
      testJobfitRunId,
      "fp_expected_different",
    )
    if (r.outcome !== "new") fail("4: completed+mismatch → outcome=new", r.outcome)
    else if (r.row !== null) fail("4: completed+mismatch → row=null", String(r.row))
    else pass("4: completed with mismatched fingerprint returns outcome=new")
    await deleteRuns([id])
  }

  // Test 5: in_progress (newer) + completed (older) → outcome='resume'
  {
    const completedId = await insertRun({
      status: "completed",
      fingerprintHash: "fp_complete",
      createdAtOffsetMs: -60_000,
    })
    const inProgressId = await insertRun({
      status: "in_progress",
      fingerprintHash: "fp_inprog",
      createdAtOffsetMs: 0,
    })
    const r = await findExistingPositioningRun(
      sb,
      testProfileId,
      testPersonaId,
      testJobfitRunId,
      "fp_complete",
    )
    if (r.outcome !== "resume") fail("5: in_progress newer → outcome=resume", r.outcome)
    else if (r.row?.id !== inProgressId)
      fail("5: returns in_progress row", `got ${r.row?.id}`)
    else pass("5: in_progress+completed (in_progress newer) returns outcome=resume")
    await deleteRuns([completedId, inProgressId])
  }

  // Test 5b: in_progress (older) + completed (newer) → outcome='resume' (in_progress still wins)
  {
    const inProgressId = await insertRun({
      status: "in_progress",
      fingerprintHash: "fp_inprog",
      createdAtOffsetMs: -60_000,
    })
    const completedId = await insertRun({
      status: "completed",
      fingerprintHash: "fp_complete",
      createdAtOffsetMs: 0,
    })
    const r = await findExistingPositioningRun(
      sb,
      testProfileId,
      testPersonaId,
      testJobfitRunId,
      "fp_complete",
    )
    if (r.outcome !== "resume") fail("5b: in_progress wins regardless of age", r.outcome)
    else if (r.row?.id !== inProgressId)
      fail("5b: returns in_progress row even when older", `got ${r.row?.id}`)
    else pass("5b: in_progress wins even when older than completed")
    await deleteRuns([inProgressId, completedId])
  }

  // Test 6: completed + abandoned → outcome='cache_hit' (abandoned ignored)
  {
    const abandonedId = await insertRun({
      status: "abandoned",
      fingerprintHash: "fp_abandoned_irrelevant",
      createdAtOffsetMs: 0, // newer
    })
    const completedId = await insertRun({
      status: "completed",
      fingerprintHash: "fp_match",
      createdAtOffsetMs: -30_000,
    })
    const r = await findExistingPositioningRun(
      sb,
      testProfileId,
      testPersonaId,
      testJobfitRunId,
      "fp_match",
    )
    if (r.outcome !== "cache_hit") fail("6: abandoned ignored, completed→cache_hit", r.outcome)
    else if (r.row?.id !== completedId)
      fail("6: returns completed row", `got ${r.row?.id}`)
    else pass("6: abandoned row ignored; completed with match returns cache_hit")
    await deleteRuns([abandonedId, completedId])
  }

  // Test 6b: abandoned only → outcome='new' (no live rows)
  {
    const id = await insertRun({ status: "abandoned", fingerprintHash: "fp_any" })
    const r = await findExistingPositioningRun(
      sb,
      testProfileId,
      testPersonaId,
      testJobfitRunId,
      "fp_any",
    )
    if (r.outcome !== "new") fail("6b: abandoned only → outcome=new", r.outcome)
    else if (r.row !== null) fail("6b: abandoned only → row=null", String(r.row))
    else pass("6b: abandoned-only state returns outcome=new")
    await deleteRuns([id])
  }

  // Test 7: Multiple completed, latest fingerprint matches → outcome='cache_hit'
  {
    const olderId = await insertRun({
      status: "completed",
      fingerprintHash: "fp_old",
      createdAtOffsetMs: -60_000,
    })
    const newerId = await insertRun({
      status: "completed",
      fingerprintHash: "fp_new",
      createdAtOffsetMs: 0,
    })
    const r = await findExistingPositioningRun(
      sb,
      testProfileId,
      testPersonaId,
      testJobfitRunId,
      "fp_new",
    )
    if (r.outcome !== "cache_hit") fail("7: latest matches → cache_hit", r.outcome)
    else if (r.row?.id !== newerId)
      fail("7: returns LATEST completed row", `got ${r.row?.id} expected ${newerId}`)
    else pass("7: multiple completed, latest matches → cache_hit on latest")
    await deleteRuns([olderId, newerId])
  }

  // Test 8: Multiple completed, latest mismatches (older matches) → outcome='new'
  //   "We don't search history; latest wins or fails" semantics.
  {
    const olderMatchingId = await insertRun({
      status: "completed",
      fingerprintHash: "fp_match",
      createdAtOffsetMs: -60_000,
    })
    const newerMismatchId = await insertRun({
      status: "completed",
      fingerprintHash: "fp_drift",
      createdAtOffsetMs: 0,
    })
    const r = await findExistingPositioningRun(
      sb,
      testProfileId,
      testPersonaId,
      testJobfitRunId,
      "fp_match",
    )
    if (r.outcome !== "new")
      fail("8: latest mismatch + older match → outcome=new", r.outcome)
    else if (r.row !== null)
      fail("8: latest mismatch + older match → row=null", `got ${r.row?.id}`)
    else pass("8: latest-wins-or-fails — older matching row doesn't rescue")
    await deleteRuns([olderMatchingId, newerMismatchId])
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n=== Guards and filters ===")
  // ════════════════════════════════════════════════════════════════════════

  // Test 9: empty input guards (4 separate)
  {
    const r1 = await findExistingPositioningRun(sb, "", testPersonaId, testJobfitRunId, "fp")
    const r2 = await findExistingPositioningRun(sb, testProfileId, "", testJobfitRunId, "fp")
    const r3 = await findExistingPositioningRun(sb, testProfileId, testPersonaId, "", "fp")
    const r4 = await findExistingPositioningRun(sb, testProfileId, testPersonaId, testJobfitRunId, "")
    let ok = true
    if (r1.outcome !== "new" || r1.error !== "missing profileId") {
      fail("9: empty profileId → outcome=new + guard error", `outcome=${r1.outcome} error=${r1.error}`)
      ok = false
    }
    if (r2.outcome !== "new" || r2.error !== "missing personaId") {
      fail("9: empty personaId → outcome=new + guard error", `outcome=${r2.outcome} error=${r2.error}`)
      ok = false
    }
    if (r3.outcome !== "new" || r3.error !== "missing jobfitRunId") {
      fail("9: empty jobfitRunId → outcome=new + guard error", `outcome=${r3.outcome} error=${r3.error}`)
      ok = false
    }
    if (r4.outcome !== "new" || r4.error !== "missing expectedFingerprintHash") {
      fail("9: empty fingerprint → outcome=new + guard error", `outcome=${r4.outcome} error=${r4.error}`)
      ok = false
    }
    if (ok) pass("9: all four empty inputs return outcome=new with named guard errors")
  }

  // Test 10: Different jobfit_run_id → outcome='new' (row exists but filtered out)
  {
    const realId = await insertRun({ status: "in_progress", fingerprintHash: "fp_test10" })
    // Use a valid-format UUID that isn't testJobfitRunId
    const otherJobfitRunId = "00000000-0000-4000-a000-000000000000"
    const r = await findExistingPositioningRun(
      sb,
      testProfileId,
      testPersonaId,
      otherJobfitRunId,
      "fp_test10",
    )
    if (r.outcome !== "new") fail("10: different jobfit_run_id → outcome=new", r.outcome)
    else if (r.row !== null) fail("10: filtered row → row=null", String(r.row))
    else pass("10: different jobfit_run_id correctly filters out matching row")
    await deleteRuns([realId])
  }

  // Test 11: Multiple in_progress (anomaly) → outcome='resume' with latest
  //   This shouldn't happen in production but the function must be defensive.
  //   The console.warn is observable but we don't assert on it.
  {
    const olderInProgressId = await insertRun({
      status: "in_progress",
      fingerprintHash: "fp_older",
      createdAtOffsetMs: -60_000,
    })
    const newerInProgressId = await insertRun({
      status: "in_progress",
      fingerprintHash: "fp_newer",
      createdAtOffsetMs: 0,
    })
    const r = await findExistingPositioningRun(
      sb,
      testProfileId,
      testPersonaId,
      testJobfitRunId,
      "fp_anything",
    )
    if (r.outcome !== "resume") fail("11: anomaly → outcome=resume", r.outcome)
    else if (r.row?.id !== newerInProgressId)
      fail("11: anomaly picks latest in_progress", `got ${r.row?.id} expected ${newerInProgressId}`)
    else pass("11: multiple in_progress (anomaly) returns latest with warning")
    await deleteRuns([olderInProgressId, newerInProgressId])
  }
 } catch (e) {
  console.error(`\nFatal: ${(e as Error).message}`)
  failures.push(`fatal: ${(e as Error).message}`)
 } finally {
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n=== Cleanup ===")
  // ────────────────────────────────────────────────────────────────────────
  // positioning_runs_v2 rows are deleted per-test; clean up any leftover
  // jobfit_run + signal_application fixtures.
  if (testJobfitRunId) {
    const { error } = await sb.from("jobfit_runs").delete().eq("id", testJobfitRunId)
    if (error) {
      console.log(`  ✗ FAILED to delete jobfit_run ${testJobfitRunId}: ${error.message}`)
      console.log(`     MANUAL CLEANUP: DELETE FROM public.jobfit_runs WHERE id = '${testJobfitRunId}';`)
      failures.push("cleanup jobfit_run")
    } else {
      console.log(`  ✓ deleted jobfit_run ${testJobfitRunId.slice(0, 8)}…`)
    }
  }
  if (testAppId) {
    const { error } = await sb.from("signal_applications").delete().eq("id", testAppId)
    if (error) {
      console.log(`  ✗ FAILED to delete signal_app ${testAppId}: ${error.message}`)
      console.log(`     MANUAL CLEANUP: DELETE FROM public.signal_applications WHERE id = '${testAppId}';`)
      failures.push("cleanup signal_app")
    } else {
      console.log(`  ✓ deleted signal_app ${testAppId.slice(0, 8)}…`)
    }
  }
 }

 console.log(`\n=== RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} ===`)
 if (failures.length) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
 }
 console.log("All checks passed.")
}

main().catch((e) => {
  console.error(`Fatal in main(): ${(e as Error).message}`)
  process.exit(1)
})
