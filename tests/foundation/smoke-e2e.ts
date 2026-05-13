// tests/foundation/smoke-e2e.ts
//
// End-to-end smoke test for Foundation deliverables. Exercises:
//   1. candidate_targeting exists for an existing dev profile (intake chain
//      validated by prior dev migration — re-confirming the read works)
//   2. signal_applications schema has new FK columns (Stage 1a)
//   3. findOrCreateSignalApplication utility creates a row and links jobfit_run_id
//      (Stage 1b — extracted from JobFit route)
//   4. Re-calling the utility with same key + different run_id UPDATEs the
//      existing row (idempotent lookup-or-create)
//   5. positioning_run_id + coverletter_run_id columns are writable
//
// Runs against dev DB. Inserts synthetic jobfit_runs + signal_applications
// rows, then cleans up at the end. No Proxy wrapper (cleanup needs DELETE).
//
// Run:
//   npx tsx tests/foundation/smoke-e2e.ts
//
// Exits 0 on PASS, 1 on any FAIL. Cleanup runs in finally{} regardless.

import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { findOrCreateSignalApplication } from "@/lib/signalApplications"

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
  auth: { persistSession: false, autoRefreshToken: false },
})

// Pick one of the 4 dev profiles that has a candidate_targeting row from migration
const TEST_PROFILE_ID = "b08e9cf1-dd1f-497a-9819-457a47e98fd9"

// Unique markers for test rows so we can clean up even if assertions fail
const RUN_ID_1 = randomUUID()
const RUN_ID_2 = randomUUID()
const TEST_COMPANY = `__SMOKE_TEST_${randomUUID().slice(0, 8)}`
const TEST_JOB_TITLE = "Foundation E2E Smoke Test Role"

const insertedRunIds: string[] = []
const insertedAppIds: string[] = []

const failures: string[] = []
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(name + (detail ? ` — ${detail}` : ""))
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

console.log(`Dev: ${env.SUPABASE_URL}`)
console.log(`Test profile: ${TEST_PROFILE_ID}`)
console.log("")

async function main(): Promise<void> {
try {
  // ──────────────────────────────────────────────────────────────────────
  console.log("=== Step 1: candidate_targeting row exists for test profile ===")
  // ──────────────────────────────────────────────────────────────────────
  const { data: target, error: targetErr } = await sb
    .from("candidate_targeting")
    .select("profile_id, primary_lane, primary_sublane, source")
    .eq("profile_id", TEST_PROFILE_ID)
    .maybeSingle()
  check("Read candidate_targeting row", !targetErr, targetErr?.message)
  check("Row exists for test profile", target !== null)
  if (target) {
    check("source = 'migration'", target.source === "migration")
    check(
      `primary_lane is a valid taxonomy id (got: ${target.primary_lane})`,
      typeof target.primary_lane === "string" && target.primary_lane.length > 0,
    )
    console.log(`  Info: lane=${target.primary_lane}, sublane=${target.primary_sublane ?? "(null)"}`)
  }
  console.log("")

  // ──────────────────────────────────────────────────────────────────────
  console.log("=== Step 2: signal_applications has new FK columns ===")
  // ──────────────────────────────────────────────────────────────────────
  // SELECT with the column names — query succeeds if columns exist
  const { error: schemaErr } = await sb
    .from("signal_applications")
    .select("id, jobfit_run_id, positioning_run_id, coverletter_run_id")
    .limit(0)
  check(
    "signal_applications has positioning_run_id + coverletter_run_id",
    !schemaErr,
    schemaErr?.message,
  )
  console.log("")

  // ──────────────────────────────────────────────────────────────────────
  console.log("=== Step 3: insert synthetic jobfit_runs row #1 ===")
  // ──────────────────────────────────────────────────────────────────────
  const { data: run1, error: run1Err } = await sb
    .from("jobfit_runs")
    .insert({
      id: RUN_ID_1,
      client_profile_id: TEST_PROFILE_ID,
      job_url: "smoke://foundation-e2e-run-1",
      fingerprint_hash: `smoke-test-${RUN_ID_1}`,
      fingerprint_code: `smoke-test-${RUN_ID_1.slice(0, 8)}`,
      verdict: "Apply",
      result_json: {
        decision: "Apply",
        score: 75,
        job_signals: { jobTitle: TEST_JOB_TITLE, companyName: TEST_COMPANY },
      },
    })
    .select("id")
    .single()
  check("Insert jobfit_runs row #1", !run1Err && !!run1, run1Err?.message)
  if (run1?.id) insertedRunIds.push(run1.id)
  console.log("")

  // ──────────────────────────────────────────────────────────────────────
  console.log("=== Step 4: findOrCreateSignalApplication creates new app ===")
  // ──────────────────────────────────────────────────────────────────────
  const result1 = await findOrCreateSignalApplication({
    supabase: sb,
    profileId: TEST_PROFILE_ID,
    companyName: TEST_COMPANY,
    jobTitle: TEST_JOB_TITLE,
    jobUrl: "smoke://foundation-e2e-run-1",
    location: "Test City",
    jobfitRunId: RUN_ID_1,
  })
  check("findOrCreateSignalApplication returned id", result1.id !== null)
  check("isNew = true (first call)", result1.isNew === true)
  check("no error", !result1.error, result1.error)
  if (result1.id) insertedAppIds.push(result1.id)

  // Verify the row was actually written with the right FK
  if (result1.id) {
    const { data: app1 } = await sb
      .from("signal_applications")
      .select(
        "id, profile_id, company_name, job_title, jobfit_run_id, positioning_run_id, coverletter_run_id",
      )
      .eq("id", result1.id)
      .maybeSingle()
    check("signal_applications row readable by returned id", app1 !== null)
    check("profile_id matches test profile", app1?.profile_id === TEST_PROFILE_ID)
    check("company_name matches", app1?.company_name === TEST_COMPANY)
    check("job_title matches", app1?.job_title === TEST_JOB_TITLE)
    check("jobfit_run_id linked to run #1", app1?.jobfit_run_id === RUN_ID_1)
    check("positioning_run_id is null (not yet populated)", app1?.positioning_run_id === null)
    check("coverletter_run_id is null (not yet populated)", app1?.coverletter_run_id === null)
  }
  console.log("")

  // ──────────────────────────────────────────────────────────────────────
  console.log("=== Step 5: insert synthetic jobfit_runs row #2 (same job) ===")
  // ──────────────────────────────────────────────────────────────────────
  const { data: run2, error: run2Err } = await sb
    .from("jobfit_runs")
    .insert({
      id: RUN_ID_2,
      client_profile_id: TEST_PROFILE_ID,
      job_url: "smoke://foundation-e2e-run-2",
      fingerprint_hash: `smoke-test-${RUN_ID_2}`,
      fingerprint_code: `smoke-test-${RUN_ID_2.slice(0, 8)}`,
      verdict: "Apply",
      result_json: {
        decision: "Apply",
        score: 80,
        job_signals: { jobTitle: TEST_JOB_TITLE, companyName: TEST_COMPANY },
      },
    })
    .select("id")
    .single()
  check("Insert jobfit_runs row #2", !run2Err && !!run2, run2Err?.message)
  if (run2?.id) insertedRunIds.push(run2.id)
  console.log("")

  // ──────────────────────────────────────────────────────────────────────
  console.log("=== Step 6: findOrCreateSignalApplication updates existing app ===")
  // ──────────────────────────────────────────────────────────────────────
  const result2 = await findOrCreateSignalApplication({
    supabase: sb,
    profileId: TEST_PROFILE_ID,
    companyName: TEST_COMPANY,
    jobTitle: TEST_JOB_TITLE,
    jobUrl: "smoke://foundation-e2e-run-2",
    location: "Test City",
    jobfitRunId: RUN_ID_2,
  })
  check(
    "same id returned (lookup hit)",
    result2.id === result1.id,
    `expected ${result1.id}, got ${result2.id}`,
  )
  check("isNew = false (second call, found existing)", result2.isNew === false)
  check("no error", !result2.error, result2.error)

  if (result2.id) {
    const { data: app2 } = await sb
      .from("signal_applications")
      .select("jobfit_run_id")
      .eq("id", result2.id)
      .maybeSingle()
    check("jobfit_run_id updated to run #2", app2?.jobfit_run_id === RUN_ID_2)
  }
  console.log("")

  // ──────────────────────────────────────────────────────────────────────
  console.log("=== Step 7: positioning_run_id can be set via the utility ===")
  // ──────────────────────────────────────────────────────────────────────
  // Synthesize a positioning_runs id by inserting one (FK requires the row exist)
  const POSITIONING_RUN_ID = randomUUID()
  const { error: posRunErr } = await sb.from("positioning_runs").insert({
    id: POSITIONING_RUN_ID,
    client_profile_id: TEST_PROFILE_ID,
    job_url: "smoke://foundation-e2e-positioning",
    fingerprint_hash: `smoke-test-pos-${POSITIONING_RUN_ID}`,
    fingerprint_code: `smoke-test-pos-${POSITIONING_RUN_ID.slice(0, 8)}`,
    result_json: { synthetic: true },
  })
  check("Insert positioning_runs row", !posRunErr, posRunErr?.message)

  const result3 = await findOrCreateSignalApplication({
    supabase: sb,
    profileId: TEST_PROFILE_ID,
    companyName: TEST_COMPANY,
    jobTitle: TEST_JOB_TITLE,
    positioningRunId: POSITIONING_RUN_ID,
  })
  check("same id (still lookup hit)", result3.id === result1.id)
  check("isNew = false", result3.isNew === false)
  check("no error setting positioning_run_id", !result3.error, result3.error)

  if (result3.id) {
    const { data: app3 } = await sb
      .from("signal_applications")
      .select("jobfit_run_id, positioning_run_id, coverletter_run_id")
      .eq("id", result3.id)
      .maybeSingle()
    check("jobfit_run_id still run #2 (not overwritten)", app3?.jobfit_run_id === RUN_ID_2)
    check("positioning_run_id now set", app3?.positioning_run_id === POSITIONING_RUN_ID)
    check("coverletter_run_id still null", app3?.coverletter_run_id === null)
  }

  // Track for cleanup
  ;(globalThis as { __testPositioningRunId?: string }).__testPositioningRunId =
    POSITIONING_RUN_ID
  console.log("")
} catch (e) {
  console.error(`Fatal: ${e instanceof Error ? e.message : String(e)}`)
  failures.push(`Fatal: ${e instanceof Error ? e.message : String(e)}`)
} finally {
  // ──────────────────────────────────────────────────────────────────────
  console.log("=== Cleanup ===")
  // ──────────────────────────────────────────────────────────────────────
  for (const id of insertedAppIds) {
    const { error } = await sb.from("signal_applications").delete().eq("id", id)
    console.log(`  ${error ? "✗" : "✓"} delete signal_applications ${id.slice(0, 8)}…${error ? " — " + error.message : ""}`)
  }
  for (const id of insertedRunIds) {
    const { error } = await sb.from("jobfit_runs").delete().eq("id", id)
    console.log(`  ${error ? "✗" : "✓"} delete jobfit_runs ${id.slice(0, 8)}…${error ? " — " + error.message : ""}`)
  }
  const posId = (globalThis as { __testPositioningRunId?: string })
    .__testPositioningRunId
  if (posId) {
    const { error } = await sb
      .from("positioning_runs")
      .delete()
      .eq("id", posId)
    console.log(`  ${error ? "✗" : "✓"} delete positioning_runs ${posId.slice(0, 8)}…${error ? " — " + error.message : ""}`)
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
  console.error("Fatal:", e instanceof Error ? e.message : String(e))
  process.exit(1)
})
