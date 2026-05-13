// tests/positioning-v2/jobfit-lookup-check.ts
//
// Integration smoke for lib/positioning/v2/jobfitLookup.ts on DEV.
// Creates test fixtures (1 signal_application + 3 jobfit_runs), runs
// the lookups, cleans up in finally.
//
// Run:
//   npx tsx tests/positioning-v2/jobfit-lookup-check.ts
//
// Exits 1 on any failure. Pulls SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// from .env.development.local.

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import {
  findLatestJobfitRunForJob,
  getJobfitRunById,
} from "@/lib/positioning/v2/jobfitLookup"

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
const TEST_COMPANY = `[verify-jflookup] Test Co ${TS}`
const TEST_TITLE = `[verify-jflookup] Senior Eng ${TS}`

let testProfileId: string = ""
let testAppId: string | null = null
let testJrIdLatest: string | null = null
let testJrIdEarlier: string | null = null
let testJrIdError: string | null = null

const failures: string[] = []
function pass(m: string): void {
  console.log(`  ✓ ${m}`)
}
function fail(m: string, d?: string): void {
  failures.push(m)
  console.log(`  ✗ ${m}${d ? ` — ${d}` : ""}`)
}

console.log(`Dev project: ${env.SUPABASE_URL}`)

async function main(): Promise<void> {
 try {
  // ────────────────────────────────────────────────────────────────────────
  // Find a test profile (any candidate profile; coach profile is fine too
  // — this test doesn't care about persona)
  // ────────────────────────────────────────────────────────────────────────
  const { data: profiles, error: profErr } = await sb
    .from("client_profiles")
    .select("id, email")
    .limit(1)
  if (profErr || !profiles?.length) {
    throw new Error(`Could not find a client_profile: ${profErr?.message ?? "no rows"}`)
  }
  testProfileId = profiles[0].id
  console.log(`  using profile ${testProfileId} (${profiles[0].email})`)

  // ────────────────────────────────────────────────────────────────────────
  // Create signal_application
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
  console.log(`  created signal_application ${testAppId}`)

  // ────────────────────────────────────────────────────────────────────────
  // Create 3 jobfit_runs: error (earliest), valid earlier, valid latest
  // ────────────────────────────────────────────────────────────────────────
  const baseTs = Date.now()
  const jrPayloads = [
    {
      label: "error",
      verdict: "error",
      created_at: new Date(baseTs - 60_000).toISOString(),
    },
    {
      label: "earlier",
      verdict: "Apply",
      created_at: new Date(baseTs - 30_000).toISOString(),
    },
    {
      label: "latest",
      verdict: "Apply",
      created_at: new Date(baseTs).toISOString(),
    },
  ]
  const insertedIds: Record<string, string> = {}
  for (const p of jrPayloads) {
    const { data, error } = await sb
      .from("jobfit_runs")
      .insert({
        client_profile_id: testProfileId,
        application_id: testAppId,
        fingerprint_hash: `verify-jflookup-${p.label}-${TS}`,
        fingerprint_code: `verify|jflookup|${p.label}`,
        verdict: p.verdict,
        result_json: { decision: p.verdict, score: 75 },
        created_at: p.created_at,
      })
      .select("id")
      .single()
    if (error || !data) {
      throw new Error(`jobfit_run ${p.label} insert failed: ${error?.message ?? "no row"}`)
    }
    insertedIds[p.label] = data.id
  }
  testJrIdError = insertedIds.error
  testJrIdEarlier = insertedIds.earlier
  testJrIdLatest = insertedIds.latest
  console.log(
    `  created jobfit_runs: error=${testJrIdError.slice(0, 8)}… earlier=${testJrIdEarlier.slice(0, 8)}… latest=${testJrIdLatest.slice(0, 8)}…`,
  )

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n=== getJobfitRunById ===")
  // ════════════════════════════════════════════════════════════════════════

  // Test 1: valid id → returns row with expected shape
  {
    const r = await getJobfitRunById(sb, testJrIdLatest)
    if (r.error) {
      fail("1: valid id → no error", r.error)
    } else if (!r.row) {
      fail("1: valid id → row present", "got null")
    } else {
      pass(`1: valid id returns row (id=${r.row.id.slice(0, 8)}…)`)
      if (r.row.id !== testJrIdLatest) fail("1: row.id matches", r.row.id)
      if (r.row.client_profile_id !== testProfileId)
        fail("1: row.client_profile_id matches", r.row.client_profile_id)
      if (r.row.application_id !== testAppId)
        fail("1: row.application_id matches", r.row.application_id ?? "null")
      if (r.row.verdict !== "Apply") fail("1: row.verdict = 'Apply'", r.row.verdict)
      if (!r.row.result_json || typeof r.row.result_json !== "object")
        fail("1: row.result_json is an object")
      else pass("1: row shape valid (all 6 fields populated)")
      if (typeof r.row.created_at !== "string")
        fail("1: row.created_at is string", typeof r.row.created_at)
    }
  }

  // Test 2: non-existent id → row null, no error
  {
    const r = await getJobfitRunById(sb, "00000000-0000-4000-a000-000000000000")
    if (r.error) {
      fail("2: non-existent id → no error", r.error)
    } else if (r.row !== null) {
      fail("2: non-existent id → row null", JSON.stringify(r.row))
    } else {
      pass("2: non-existent id returns {row: null}")
    }
  }

  // Test 3: empty string → guard error
  {
    const r = await getJobfitRunById(sb, "")
    if (r.row !== null || r.error !== "missing jobfitRunId") {
      fail("3: empty id → guard error", `row=${r.row} error=${r.error}`)
    } else {
      pass("3: empty id returns guard error")
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n=== findLatestJobfitRunForJob ===")
  // ════════════════════════════════════════════════════════════════════════

  // Test 4: matching company+title returns latest NON-error run (not earlier, not error)
  {
    const r = await findLatestJobfitRunForJob(
      sb,
      testProfileId,
      TEST_COMPANY,
      TEST_TITLE,
    )
    if (r.error) {
      fail("4: exact match → no error", r.error)
    } else if (!r.row) {
      fail("4: exact match → row present", "got null")
    } else if (r.row.id !== testJrIdLatest) {
      fail(
        "4: returns latest non-error run",
        `got ${r.row.id.slice(0, 8)}… expected ${testJrIdLatest.slice(0, 8)}…`,
      )
    } else {
      pass("4: matching company+title returns latest non-error jobfit_run")
    }
  }

  // Test 5: case-insensitive match (ILIKE)
  {
    const r = await findLatestJobfitRunForJob(
      sb,
      testProfileId,
      TEST_COMPANY.toUpperCase(),
      TEST_TITLE.toUpperCase(),
    )
    if (r.error) {
      fail("5: uppercase → no error", r.error)
    } else if (!r.row) {
      fail("5: uppercase → matches via ILIKE", "got null")
    } else if (r.row.id !== testJrIdLatest) {
      fail("5: ILIKE returns latest", `got ${r.row.id.slice(0, 8)}…`)
    } else {
      pass("5: ILIKE case-insensitive match works")
    }
  }

  // Test 6: whitespace-padded company does NOT match (no internal trim — caller's job)
  {
    const r = await findLatestJobfitRunForJob(
      sb,
      testProfileId,
      "  " + TEST_COMPANY + "  ",
      TEST_TITLE,
    )
    if (r.row !== null) {
      fail("6: whitespace-padded company → no match (caller trims)", `got ${r.row.id.slice(0, 8)}…`)
    } else {
      pass("6: whitespace-padded company doesn't ILIKE-match (caller responsible for trim)")
    }
  }

  // Test 7: no matching application → row null
  {
    const r = await findLatestJobfitRunForJob(
      sb,
      testProfileId,
      `Nonexistent Co ${TS}`,
      `Nothing Title ${TS}`,
    )
    if (r.error) {
      fail("7: no match → no error", r.error)
    } else if (r.row !== null) {
      fail("7: no match → row null", JSON.stringify(r.row))
    } else {
      pass("7: no matching signal_application returns {row: null}")
    }
  }

  // Test 8: empty inputs → guard errors
  {
    const r1 = await findLatestJobfitRunForJob(sb, "", "X", "Y")
    const r2 = await findLatestJobfitRunForJob(sb, testProfileId, "", "Y")
    const r3 = await findLatestJobfitRunForJob(sb, testProfileId, "X", "")
    if (r1.error !== "missing profileId")
      fail("8: empty profileId → guard error", r1.error)
    else if (r2.error !== "missing company")
      fail("8: empty company → guard error", r2.error)
    else if (r3.error !== "missing jobTitle")
      fail("8: empty jobTitle → guard error", r3.error)
    else pass("8: all three empty inputs return guard errors")
  }

  // Test 9: company matches but title doesn't → no match (both required, AND not OR)
  {
    const r = await findLatestJobfitRunForJob(
      sb,
      testProfileId,
      TEST_COMPANY,
      `Different Title ${TS}`,
    )
    if (r.row !== null) {
      fail(
        "9: company-only match → no result (AND semantics)",
        `got ${r.row.id.slice(0, 8)}…`,
      )
    } else {
      pass("9: company-only match returns null (both columns required)")
    }
  }

  // Test 10: matching application but only verdict='error' jobfit_runs → row null
  //   Simulate by inserting a separate signal_application with only an error run.
  {
    const tinyTs = Date.now()
    const onlyErrorCompany = `[verify-jflookup] OnlyError Co ${tinyTs}`
    const onlyErrorTitle = `[verify-jflookup] OnlyError Title ${tinyTs}`
    const { data: app2, error: app2Err } = await sb
      .from("signal_applications")
      .insert({
        profile_id: testProfileId,
        company_name: onlyErrorCompany,
        job_title: onlyErrorTitle,
        location: "",
        job_url: "",
        application_status: "saved",
        interest_level: 1,
      })
      .select("id")
      .single()
    if (app2Err || !app2) {
      fail("10: setup (app2 insert)", app2Err?.message)
    } else {
      const { data: jrErr2, error: jrErr2Err } = await sb
        .from("jobfit_runs")
        .insert({
          client_profile_id: testProfileId,
          application_id: app2.id,
          fingerprint_hash: `verify-jflookup-only-error-${tinyTs}`,
          fingerprint_code: `verify|jflookup|only-error`,
          verdict: "error",
          result_json: { decision: "error" },
        })
        .select("id")
        .single()
      if (jrErr2Err || !jrErr2) {
        fail("10: setup (error jobfit_run insert)", jrErr2Err?.message)
      } else {
        const r = await findLatestJobfitRunForJob(
          sb,
          testProfileId,
          onlyErrorCompany,
          onlyErrorTitle,
        )
        if (r.error) {
          fail("10: only-error case → no error", r.error)
        } else if (r.row !== null) {
          fail(
            "10: only-error case → row null (excluded by verdict filter)",
            `got verdict=${r.row.verdict}`,
          )
        } else {
          pass("10: application with only verdict='error' runs returns null")
        }
        // Clean up the extra fixtures
        await sb.from("jobfit_runs").delete().eq("id", jrErr2.id)
        await sb.from("signal_applications").delete().eq("id", app2.id)
      }
    }
  }
} catch (e) {
  console.error(`\nFatal: ${(e as Error).message}`)
  failures.push(`fatal: ${(e as Error).message}`)
} finally {
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n=== Cleanup ===")
  // ────────────────────────────────────────────────────────────────────────
  // Delete jobfit_runs first (their application_id FKs the signal_app)
  for (const [label, id] of [
    ["error", testJrIdError],
    ["earlier", testJrIdEarlier],
    ["latest", testJrIdLatest],
  ] as const) {
    if (id) {
      const { error } = await sb.from("jobfit_runs").delete().eq("id", id)
      if (error) {
        console.log(`  ✗ FAILED to delete jobfit_run ${label} ${id}: ${error.message}`)
        console.log(`     MANUAL CLEANUP: DELETE FROM public.jobfit_runs WHERE id = '${id}';`)
        failures.push(`cleanup ${label}`)
      } else {
        console.log(`  ✓ deleted jobfit_run ${label} ${id.slice(0, 8)}…`)
      }
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
