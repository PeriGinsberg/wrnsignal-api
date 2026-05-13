// scripts/verify-positioning-v2-start.mjs
//
// End-to-end smoke for POST /api/positioning/v2/start.
//
// Exercises the full handler integration:
//   - Auth via signInWithPassword + Bearer JWT
//   - JobFit lookup + F11 ownership check (404 envelope)
//   - F6 persona guard (no_persona_configured)
//   - F7 null candidate_targeting (allowed)
//   - DD-27 placeholder convention for empty job_signals
//   - DD-26 one-directional link (positioning_runs_v2.signal_application_id)
//   - 3-way outcome cascade: new → resume → cache_hit
//   - F12 cache_hit is_returning=false semantics
//   - F10 visit append on all outcomes
//   - Response shape per types.ts StartResponse
//
// Prerequisites:
//   1. Dev server running: `npm run dev` in another terminal (defaults to
//      http://localhost:3000; override via POSITIONING_V2_BASE_URL).
//   2. seed-dev-fixture.ts has been run on dev (alex+test, brooke+test,
//      casey+test exist with password dev-test-1234).
//   3. .env.development.local has SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY.
//
// Run:
//   node scripts/verify-positioning-v2-start.mjs
//
// Exits 1 on any failure. Cleanup attempts to delete all fixtures it
// created, including the throwaway auth user (test 9).
//
// MANUAL RECOVERY if interrupted:
//   If this script is killed mid-run, throwaway users may leak into
//   auth.users. To clean up, on dev SQL Editor:
//     SELECT id, email FROM auth.users WHERE email LIKE 'no-persona+%@test.invalid';
//   Then for each id: supabase.auth.admin.deleteUser(id) — or run this
//   script again; the timestamp-suffixed emails won't collide.
//   Also check for orphaned test fixtures:
//     SELECT id, company_name FROM signal_applications
//       WHERE company_name LIKE '[verify-start-%]%' OR company_name = '(Unknown Company)';
//     SELECT id, fingerprint_hash FROM jobfit_runs
//       WHERE fingerprint_hash LIKE 'verify-start-%';
//     SELECT id, fingerprint_hash FROM positioning_runs_v2
//       WHERE fingerprint_hash LIKE 'verify-start-%';

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

// ────────────────────────────────────────────────────────────────────────
// Env + clients
// ────────────────────────────────────────────────────────────────────────

const env = Object.fromEntries(
  readFileSync(".env.development.local", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=")
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const required = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
]
for (const k of required) {
  if (!env[k]) {
    console.error(`Missing required env var in .env.development.local: ${k}`)
    process.exit(1)
  }
}

const sbAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const sbAnon = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

const BASE_URL =
  process.env.POSITIONING_V2_BASE_URL ?? "http://localhost:3000"
const ENDPOINT = "/api/positioning/v2/start"

const TS = Date.now()
const FIXTURE_MARKER = `[verify-start-${TS}]`
const TEST_PASSWORD = "dev-test-1234"
const EMAIL_A = "alex+test@example.com"
const EMAIL_B = "brooke+test@example.com"
const EMAIL_THROWAWAY = `no-persona+${TS}@test.invalid`

// ────────────────────────────────────────────────────────────────────────
// State trackers (for cleanup)
// ────────────────────────────────────────────────────────────────────────

const trackedRunIds = new Set()
const trackedJobfitIds = new Set()
const trackedAppIds = new Set()
let throwawayUserId = null
let throwawayProfileId = null

const failures = []
function pass(m) { console.log(`  ✓ ${m}`) }
function fail(m, d) {
  failures.push(m)
  console.log(`  ✗ ${m}${d !== undefined ? ` — ${d}` : ""}`)
}

// ────────────────────────────────────────────────────────────────────────
// HTTP + auth helpers
// ────────────────────────────────────────────────────────────────────────

async function signInAndLookup(email, password) {
  const { data, error } = await sbAnon.auth.signInWithPassword({ email, password })
  if (error || !data?.session) {
    throw new Error(`signIn ${email}: ${error?.message ?? "no session"}`)
  }
  const userId = data.session.user.id
  // Profile may not exist yet for a freshly-created user (throwaway path);
  // getAuthedProfileText auto-creates on first /start call. Return null
  // profileId in that case.
  const { data: profile, error: profErr } = await sbAdmin
    .from("client_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle()
  if (profErr) {
    throw new Error(`profile lookup for ${email}: ${profErr.message}`)
  }
  return {
    token: data.session.access_token,
    userId,
    profileId: profile?.id ?? null,
  }
}

async function postStart(token, body) {
  const headers = { "Content-Type": "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE_URL}${ENDPOINT}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { _raw: text }
  }
  return {
    status: res.status,
    body: json,
    headers: Object.fromEntries(res.headers.entries()),
  }
}

// ────────────────────────────────────────────────────────────────────────
// Fixture builders
// ────────────────────────────────────────────────────────────────────────

function buildResultJson(opts) {
  return {
    decision: opts.decision ?? "Apply",
    score: opts.score ?? 75,
    job_signals: {
      jobTitle: opts.jobTitle ?? `Senior PM ${FIXTURE_MARKER}`,
      companyName: opts.companyName ?? `TestCorp ${FIXTURE_MARKER}`,
    },
    why_structured: opts.whyStructured ?? [
      {
        keyword: "product strategy",
        lead: "lead text",
        connection: "connection text",
        action: "action text",
      },
    ],
    risk_structured: opts.riskStructured ?? [],
    risk_codes: [],
  }
}

async function insertJobfitRun(clientProfileId, resultJson, descSuffix) {
  const { data, error } = await sbAdmin
    .from("jobfit_runs")
    .insert({
      client_profile_id: clientProfileId,
      application_id: null,
      job_url: `https://example.test/${TS}/${descSuffix}`,
      job_description: `${FIXTURE_MARKER} JD body — ${descSuffix}`,
      fingerprint_hash: `verify-start-${TS}-${descSuffix}`,
      fingerprint_code: `verify|start|${TS}|${descSuffix}`,
      verdict: resultJson.decision,
      result_json: resultJson,
    })
    .select("id")
    .single()
  if (error || !data) {
    throw new Error(`insertJobfitRun(${descSuffix}): ${error?.message ?? "no row"}`)
  }
  trackedJobfitIds.add(data.id)
  return data.id
}

/**
 * After a /start call returns a run_id, look it up and remember its
 * signal_application_id (if any) so cleanup can delete it. We don't trust
 * the response to expose the link directly — read it from the DB.
 */
async function trackRunAndItsApp(runId) {
  trackedRunIds.add(runId)
  const { data } = await sbAdmin
    .from("positioning_runs_v2")
    .select("signal_application_id")
    .eq("id", runId)
    .maybeSingle()
  if (data?.signal_application_id) {
    trackedAppIds.add(data.signal_application_id)
  }
}

// ────────────────────────────────────────────────────────────────────────
// Pre-flight: dev server responsive
// ────────────────────────────────────────────────────────────────────────

async function preflightServer() {
  try {
    const res = await fetch(`${BASE_URL}${ENDPOINT}`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000" },
    })
    // CORS preflight expected to be 204 / 200; anything else likely means
    // the server isn't running or the route isn't built yet.
    if (res.status >= 500) {
      throw new Error(`OPTIONS returned ${res.status}`)
    }
  } catch (e) {
    console.error(
      `\n✗ Dev server not responding at ${BASE_URL}.\n  Start with \`npm run dev\` in another terminal, then re-run this script.\n  Underlying: ${(e instanceof Error ? e.message : String(e))}`,
    )
    process.exit(1)
  }
}

// ────────────────────────────────────────────────────────────────────────
// Setup
// ────────────────────────────────────────────────────────────────────────

let tokenA, profileA
let tokenB, profileB
let tokenThrowaway
let jobfit1, jobfit2, jobfit3

async function setup() {
  console.log(`Dev project: ${env.SUPABASE_URL}`)
  console.log(`Base URL:    ${BASE_URL}\n`)

  console.log("=== Pre-flight ===")
  await preflightServer()
  pass("dev server is responding at " + BASE_URL)

  console.log("\n=== Sign in fixture users ===")
  const a = await signInAndLookup(EMAIL_A, TEST_PASSWORD)
  if (!a.profileId) throw new Error(`Fixture profile for ${EMAIL_A} missing — run seed-dev-fixture.ts first`)
  tokenA = a.token
  profileA = a.profileId
  pass(`alex (session A) → profile ${profileA.slice(0, 8)}…`)

  const b = await signInAndLookup(EMAIL_B, TEST_PASSWORD)
  if (!b.profileId) throw new Error(`Fixture profile for ${EMAIL_B} missing — run seed-dev-fixture.ts first`)
  tokenB = b.token
  profileB = b.profileId
  pass(`brooke (session B) → profile ${profileB.slice(0, 8)}…`)

  console.log("\n=== Create throwaway user (test 9) ===")
  const { data: created, error: createErr } = await sbAdmin.auth.admin.createUser({
    email: EMAIL_THROWAWAY,
    password: TEST_PASSWORD,
    email_confirm: true,
  })
  if (createErr || !created?.user) {
    throw new Error(`createUser ${EMAIL_THROWAWAY}: ${createErr?.message ?? "no user"}`)
  }
  throwawayUserId = created.user.id
  pass(`throwaway user ${EMAIL_THROWAWAY} (auth id ${throwawayUserId.slice(0, 8)}…)`)

  const t = await signInAndLookup(EMAIL_THROWAWAY, TEST_PASSWORD)
  tokenThrowaway = t.token
  // throwawayProfileId stays null until the first /start call auto-creates the profile
  pass(`signed in as throwaway`)

  console.log("\n=== Seed jobfit_runs ===")
  jobfit1 = await insertJobfitRun(
    profileA,
    buildResultJson({ jobTitle: `Product Manager ${FIXTURE_MARKER}`, companyName: `Acme Co ${FIXTURE_MARKER}` }),
    "jr1-alex-populated",
  )
  pass(`jobfit_run #1 (alex, populated): ${jobfit1.slice(0, 8)}…`)

  jobfit2 = await insertJobfitRun(
    profileA,
    buildResultJson({ jobTitle: `Role ${FIXTURE_MARKER}`, companyName: "" /* DD-27 placeholder path */ }),
    "jr2-alex-empty-company",
  )
  pass(`jobfit_run #2 (alex, empty companyName → placeholder path): ${jobfit2.slice(0, 8)}…`)

  jobfit3 = await insertJobfitRun(
    profileB,
    buildResultJson({ jobTitle: `Other Role ${FIXTURE_MARKER}`, companyName: `Other Co ${FIXTURE_MARKER}` }),
    "jr3-brooke-wrongowner",
  )
  pass(`jobfit_run #3 (brooke, owned by wrong user vs alex): ${jobfit3.slice(0, 8)}…`)
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

// === STATE PROGRESSION (tests 1, 2, 3) ===
// These tests share state and must run in order:
//   Test 1: new run created on jobfit #1
//   Test 2: resume same jobfit #1 (returns positioning_run from test 1)
//   <manual UPDATE: status='completed' + populated result_json on the row>
//   Test 3: cache_hit on jobfit #1
// Reordering breaks the sequence.

let test1RunId = null
const T3_CACHED_WORKFLOW = {
  gap_count: 7,
  gap_themes: ["alpha", "beta", "gamma"],
  content_review_required: true,
  audit_findings_count: null,
  estimated_minutes: 30,
}
const T3_CACHED_CASE_SPECIFIC = {
  well_positioned_summary: `cached summary ${FIXTURE_MARKER}`,
  small_refinements: [],
}

async function runTests() {
  // ── Test 1: Happy path new run ────────────────────────────────────────
  console.log("\n=== Test 1: Happy path new run ===")
  {
    const r = await postStart(tokenA, { jobfit_run_id: jobfit1 })
    if (r.status !== 200) {
      fail("1: status should be 200", `got ${r.status} body=${JSON.stringify(r.body)}`)
    } else if (r.body.outcome !== "new") {
      fail("1: outcome should be 'new'", r.body.outcome)
    } else if (!r.body.run_id) {
      fail("1: run_id should be present", JSON.stringify(r.body).slice(0, 200))
    } else if (!["A", "B", "C"].includes(r.body.case)) {
      fail("1: case should be A/B/C", r.body.case)
    } else if (r.body.is_returning !== false) {
      fail("1: is_returning should be false", String(r.body.is_returning))
    } else if (r.body.cached !== false) {
      fail("1: cached should be false", String(r.body.cached))
    } else if (r.body.last_visit_days_ago !== null) {
      fail("1: last_visit_days_ago should be null", String(r.body.last_visit_days_ago))
    } else if (!r.body.context?.persona?.id) {
      fail("1: context.persona.id missing", JSON.stringify(r.body.context))
    } else if (!("candidate_targeting" in (r.body.context ?? {}))) {
      fail("1: context.candidate_targeting should be present (even if null)")
    } else if (!r.body.context?.job?.title || !r.body.context?.job?.company) {
      fail("1: context.job.{title,company} missing", JSON.stringify(r.body.context?.job))
    } else if (!Array.isArray(r.body.phase_data?.phase_1?.visits) || r.body.phase_data.phase_1.visits.length !== 1) {
      fail("1: phase_data.phase_1.visits should have 1 entry", JSON.stringify(r.body.phase_data?.phase_1?.visits))
    } else {
      test1RunId = r.body.run_id
      await trackRunAndItsApp(test1RunId)

      // Verify the DB state: signal_application_id should be populated
      const { data: row } = await sbAdmin
        .from("positioning_runs_v2")
        .select("id, signal_application_id, status")
        .eq("id", test1RunId)
        .single()
      if (!row?.signal_application_id) {
        fail("1: positioning_runs_v2.signal_application_id should be populated after link", JSON.stringify(row))
      } else if (row.status !== "in_progress") {
        fail("1: row.status should be in_progress", row.status)
      } else {
        pass(`1: 200, outcome=new, run created, signal_application_id linked, visit recorded (run=${test1RunId.slice(0, 8)}…)`)
      }
    }
  }

  // ── Test 2: Returning user resume ─────────────────────────────────────
  console.log("\n=== Test 2: Resume ===")
  if (!test1RunId) {
    fail("2: skipped — test 1 didn't establish a run")
  } else {
    // Small delay so updated_at is observably newer
    await new Promise((res) => setTimeout(res, 200))

    const r = await postStart(tokenA, { jobfit_run_id: jobfit1 })
    if (r.status !== 200) {
      fail("2: status should be 200", `got ${r.status} body=${JSON.stringify(r.body)}`)
    } else if (r.body.outcome !== "resume") {
      fail("2: outcome should be 'resume'", r.body.outcome)
    } else if (r.body.run_id !== test1RunId) {
      fail("2: run_id should match test 1", `expected ${test1RunId}, got ${r.body.run_id}`)
    } else if (r.body.is_returning !== true) {
      fail("2: is_returning should be true", String(r.body.is_returning))
    } else if (r.body.cached !== false) {
      fail("2: cached should be false on resume", String(r.body.cached))
    } else if (r.body.last_visit_days_ago !== 0) {
      // Both visits happened within seconds — floor((delta)/ms_per_day) = 0
      fail("2: last_visit_days_ago should be 0 (visits seconds apart)", String(r.body.last_visit_days_ago))
    } else if (!Array.isArray(r.body.phase_data?.phase_1?.visits) || r.body.phase_data.phase_1.visits.length !== 2) {
      fail("2: phase_data.phase_1.visits should have 2 entries", String(r.body.phase_data?.phase_1?.visits?.length))
    } else {
      pass(`2: 200, outcome=resume, same run_id, is_returning=true, last_visit_days_ago=0, visits=2`)
    }
  }

  // ── Test 3: Cache hit (after manual completion of test1 row) ──────────
  console.log("\n=== Test 3: Cache hit (after manual completion) ===")
  if (!test1RunId) {
    fail("3: skipped — test 1 didn't establish a run")
  } else {
    // Phase 5 (which would naturally transition runs to completed) isn't built.
    // Simulate completion manually so the cache_hit cascade triggers.
    const { error: updErr } = await sbAdmin
      .from("positioning_runs_v2")
      .update({
        status: "completed",
        result_json: {
          workflow_preview: T3_CACHED_WORKFLOW,
          case_specific: T3_CACHED_CASE_SPECIFIC,
          // Other fields the real Phase 5 would populate; not required by the route's cache_hit path
          case: "B",
        },
        completed_at: new Date().toISOString(),
      })
      .eq("id", test1RunId)
    if (updErr) {
      fail("3: setup — manual completion failed", updErr.message)
    } else {
      const r = await postStart(tokenA, { jobfit_run_id: jobfit1 })
      if (r.status !== 200) {
        fail("3: status should be 200", `got ${r.status} body=${JSON.stringify(r.body)}`)
      } else if (r.body.outcome !== "cache_hit") {
        fail("3: outcome should be 'cache_hit'", r.body.outcome)
      } else if (r.body.cached !== true) {
        fail("3: cached should be true", String(r.body.cached))
      } else if (r.body.is_returning !== false) {
        fail("3: is_returning should be false on cache_hit (per F12)", String(r.body.is_returning))
      } else if (r.body.last_visit_days_ago !== null) {
        fail("3: last_visit_days_ago should be null on cache_hit", String(r.body.last_visit_days_ago))
      } else if (r.body.case_specific?.well_positioned_summary !== T3_CACHED_CASE_SPECIFIC.well_positioned_summary) {
        fail("3: case_specific should match the cached value (proves cache was read, not recomputed)", JSON.stringify(r.body.case_specific))
      } else if (r.body.workflow_preview?.gap_count !== T3_CACHED_WORKFLOW.gap_count) {
        fail("3: workflow_preview.gap_count should match cached value", `expected ${T3_CACHED_WORKFLOW.gap_count}, got ${r.body.workflow_preview?.gap_count}`)
      } else if (!Array.isArray(r.body.phase_data?.phase_1?.visits) || r.body.phase_data.phase_1.visits.length !== 3) {
        // Q4: visits append happens even on cache_hit
        fail("3: phase_data.phase_1.visits should have 3 entries (visit appended on cache_hit per Q4)", String(r.body.phase_data?.phase_1?.visits?.length))
      } else {
        pass(`3: 200, outcome=cache_hit, cached=true, is_returning=false, cached case_specific + workflow_preview surfaced, visits=3`)
      }
    }
  }

  // ── Test 4: Placeholder application (empty companyName) ───────────────
  console.log("\n=== Test 4: Placeholder application (DD-27 path) ===")
  {
    const r = await postStart(tokenA, { jobfit_run_id: jobfit2 })
    if (r.status !== 200) {
      fail("4: status should be 200", `got ${r.status} body=${JSON.stringify(r.body)}`)
    } else if (r.body.outcome !== "new") {
      fail("4: outcome should be 'new'", r.body.outcome)
    } else if (r.body.context?.job?.company !== "(Unknown Company)") {
      fail("4: context.job.company should be '(Unknown Company)'", r.body.context?.job?.company)
    } else {
      await trackRunAndItsApp(r.body.run_id)
      // Verify a signal_application was created with the placeholder company
      const { data: row } = await sbAdmin
        .from("positioning_runs_v2")
        .select("signal_application_id")
        .eq("id", r.body.run_id)
        .single()
      if (!row?.signal_application_id) {
        fail("4: signal_application_id should be populated even with placeholder")
      } else {
        const { data: app } = await sbAdmin
          .from("signal_applications")
          .select("company_name")
          .eq("id", row.signal_application_id)
          .single()
        if (app?.company_name !== "(Unknown Company)") {
          fail("4: signal_applications.company_name should be '(Unknown Company)'", app?.company_name)
        } else {
          pass("4: empty companyName → placeholder applied, signal_application created with '(Unknown Company)'")
        }
      }
    }
  }

  // ── Test 5: Missing jobfit_run_id ─────────────────────────────────────
  console.log("\n=== Test 5: Missing jobfit_run_id ===")
  {
    const r = await postStart(tokenA, {})
    if (r.status !== 400) {
      fail("5: status should be 400", `got ${r.status}`)
    } else if (r.body.error !== "missing_jobfit_run_id") {
      fail("5: error should be 'missing_jobfit_run_id'", r.body.error)
    } else {
      pass("5: 400 missing_jobfit_run_id")
    }
  }

  // ── Test 6: Unauthenticated ───────────────────────────────────────────
  console.log("\n=== Test 6: Unauthenticated ===")
  {
    const r = await postStart(null, { jobfit_run_id: jobfit1 })
    if (r.status !== 401) {
      fail("6: status should be 401", `got ${r.status} body=${JSON.stringify(r.body)}`)
    } else if (r.body.error !== "unauthorized") {
      fail("6: error should be 'unauthorized'", r.body.error)
    } else {
      pass("6: 401 unauthorized when no Bearer token")
    }
  }

  // ── Test 7: Non-existent jobfit_run_id ────────────────────────────────
  console.log("\n=== Test 7: Non-existent jobfit_run_id ===")
  {
    const bogusId = "00000000-0000-4000-a000-000000000000"
    const r = await postStart(tokenA, { jobfit_run_id: bogusId })
    if (r.status !== 404) {
      fail("7: status should be 404", `got ${r.status} body=${JSON.stringify(r.body)}`)
    } else if (r.body.error !== "jobfit_not_found") {
      fail("7: error should be 'jobfit_not_found'", r.body.error)
    } else {
      pass("7: 404 jobfit_not_found for bogus UUID")
    }
  }

  // ── Test 8: Wrong-owner jobfit_run (F11) ──────────────────────────────
  console.log("\n=== Test 8: Wrong-owner jobfit_run (F11) ===")
  {
    // alex (tokenA) hits a jobfit owned by brooke (profileB)
    const r = await postStart(tokenA, { jobfit_run_id: jobfit3 })
    if (r.status !== 404) {
      fail("8: status should be 404 (not 403, per F11 — don't leak existence)", `got ${r.status} body=${JSON.stringify(r.body)}`)
    } else if (r.body.error !== "jobfit_not_found") {
      fail("8: error should be 'jobfit_not_found' (same envelope as test 7)", r.body.error)
    } else {
      pass("8: 404 jobfit_not_found for wrong-owner — F11 envelope identical to test 7")
    }
  }

  // ── Test 9: No persona configured (F6 — throwaway user) ───────────────
  console.log("\n=== Test 9: No persona configured (F6) ===")
  {
    const r = await postStart(tokenThrowaway, { jobfit_run_id: jobfit1 })
    if (r.status !== 400) {
      fail("9: status should be 400", `got ${r.status} body=${JSON.stringify(r.body)}`)
    } else if (r.body.error !== "no_persona_configured") {
      fail("9: error should be 'no_persona_configured'", r.body.error)
    } else {
      pass("9: 400 no_persona_configured — F6 guard fires for throwaway user with no personas")
    }

    // Cleanup hook: getAuthedProfileText auto-created a client_profiles row for
    // the throwaway user on this call. Capture its id so cleanup can delete it.
    const { data: tprof } = await sbAdmin
      .from("client_profiles")
      .select("id")
      .eq("user_id", throwawayUserId)
      .maybeSingle()
    if (tprof?.id) {
      throwawayProfileId = tprof.id
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Cleanup
// ────────────────────────────────────────────────────────────────────────

async function cleanup() {
  console.log("\n=== Cleanup ===")

  // Delete positioning_runs_v2 first (they reference signal_applications +
  // jobfit_runs without CASCADE, so any FK protection comes from this order).
  let runsDeleted = 0
  for (const id of trackedRunIds) {
    const { error } = await sbAdmin.from("positioning_runs_v2").delete().eq("id", id)
    if (error) {
      console.log(`  ✗ failed to delete positioning_run ${id}: ${error.message}`)
      failures.push(`cleanup-run-${id}`)
    } else {
      runsDeleted++
    }
  }
  if (trackedRunIds.size > 0) {
    console.log(`  ✓ deleted ${runsDeleted}/${trackedRunIds.size} positioning_runs_v2 rows`)
  }

  // Delete signal_applications we know about (collected via trackRunAndItsApp).
  let appsDeleted = 0
  for (const id of trackedAppIds) {
    const { error } = await sbAdmin.from("signal_applications").delete().eq("id", id)
    if (error) {
      console.log(`  ✗ failed to delete signal_application ${id}: ${error.message}`)
      failures.push(`cleanup-app-${id}`)
    } else {
      appsDeleted++
    }
  }
  if (trackedAppIds.size > 0) {
    console.log(`  ✓ deleted ${appsDeleted}/${trackedAppIds.size} signal_applications rows`)
  }

  // Delete jobfit_runs we seeded.
  let jrDeleted = 0
  for (const id of trackedJobfitIds) {
    const { error } = await sbAdmin.from("jobfit_runs").delete().eq("id", id)
    if (error) {
      console.log(`  ✗ failed to delete jobfit_run ${id}: ${error.message}`)
      failures.push(`cleanup-jobfit-${id}`)
    } else {
      jrDeleted++
    }
  }
  if (trackedJobfitIds.size > 0) {
    console.log(`  ✓ deleted ${jrDeleted}/${trackedJobfitIds.size} jobfit_runs rows`)
  }

  // Delete throwaway client_profiles row (auto-created on test 9's /start
  // call). Defensive fallback: if test 9 threw before capturing the profile_id,
  // re-query by user_id here — auto-creation may have happened server-side
  // even if the client never observed it.
  if (!throwawayProfileId && throwawayUserId) {
    const { data: tprof } = await sbAdmin
      .from("client_profiles")
      .select("id")
      .eq("user_id", throwawayUserId)
      .maybeSingle()
    if (tprof?.id) {
      throwawayProfileId = tprof.id
      console.log(`  ℹ recovered throwaway client_profile via user_id fallback: ${throwawayProfileId.slice(0, 8)}…`)
    }
  }
  if (throwawayProfileId) {
    const { error } = await sbAdmin
      .from("client_profiles")
      .delete()
      .eq("id", throwawayProfileId)
    if (error) {
      console.log(`  ✗ failed to delete throwaway client_profile ${throwawayProfileId}: ${error.message}`)
      failures.push("cleanup-throwaway-profile")
    } else {
      console.log(`  ✓ deleted throwaway client_profile ${throwawayProfileId.slice(0, 8)}…`)
    }
  }

  // Delete throwaway auth user — last, so any FK cascades that might have
  // protected client_profiles deletion are already past.
  if (throwawayUserId) {
    const { error } = await sbAdmin.auth.admin.deleteUser(throwawayUserId)
    if (error) {
      console.log(`  ✗ failed to delete throwaway auth user ${throwawayUserId}: ${error.message}`)
      console.log(`     MANUAL CLEANUP: see header comment for recovery query`)
      failures.push("cleanup-throwaway-user")
    } else {
      console.log(`  ✓ deleted throwaway auth user ${throwawayUserId.slice(0, 8)}… (${EMAIL_THROWAWAY})`)
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────

async function main() {
  try {
    await setup()
    await runTests()
  } catch (e) {
    console.error(`\nFatal: ${e instanceof Error ? e.message : String(e)}`)
    failures.push(`fatal: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    await cleanup()
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
  console.error(`Fatal in main(): ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
