// tests/positioning-v2/run-writer-check.ts
//
// Integration smoke for lib/positioning/v2/runWriter.ts on DEV.
// Exercises:
//   - F2 self-heal (load-bearing) — DD-26 two-write pattern, idempotent
//     re-link, updated_at trigger fires on no-op UPDATE
//   - createPositioningRun: happy path, 4 guards, signal_application_id=null,
//     phase_data.phase_1 JSONB round-trip
//   - linkSignalApplicationToRun: overwrite-wins, non-existent run, 2 guards
//     (idempotency on same-id covered by self-heal)
//   - appendPhase1Visit: visits absent → initialized, append preserves order,
//     missing phase_1 errors, non-existent run, 3 guards
//
// Run:
//   npx tsx tests/positioning-v2/run-writer-check.ts
//
// Exits 1 on any failure. Pulls SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// from .env.development.local.

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import {
  appendPhase1Visit,
  createPositioningRun,
  linkSignalApplicationToRun,
} from "@/lib/positioning/v2/runWriter"
import type {
  Phase1Visit,
  PositioningRunV2InsertPayload,
  PositioningRunV2PhaseData,
} from "@/lib/positioning/v2/types"

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
const TEST_COMPANY = `[verify-runwriter] Co ${TS}`
const TEST_TITLE = `[verify-runwriter] Title ${TS}`

let testProfileId: string = ""
let testPersonaId: string = ""
let testAppId: string = ""
let testAppId2: string = ""
const createdRunIds: string[] = []

const failures: string[] = []
function pass(m: string): void {
  console.log(`  ✓ ${m}`)
}
function fail(m: string, d?: string): void {
  failures.push(m)
  console.log(`  ✗ ${m}${d ? ` — ${d}` : ""}`)
}

// Build a fully-valid INSERT payload. Each call uses a unique fingerprint_hash
// (suffixed by Math.random) so concurrent tests can't collide even though
// there's no UNIQUE constraint enforcing it (per DD-26 / Stage 1b D4 pre-checks).
function buildPayload(
  overrides: Partial<PositioningRunV2InsertPayload> = {},
): PositioningRunV2InsertPayload {
  return {
    profile_id: testProfileId,
    persona_id: testPersonaId,
    jobfit_run_id: null,
    signal_application_id: null,
    job_title: TEST_TITLE,
    job_company: TEST_COMPANY,
    job_url: null,
    job_description: "[verify-runwriter] body",
    case_assigned: "B",
    case_reasoning: "test fixture",
    current_phase: 1,
    phase_data: { phase_1: { case_assigned_at: new Date().toISOString() } },
    status: "in_progress",
    fingerprint_hash: `verify-runwriter-${TS}-${Math.random().toString(36).slice(2, 10)}`,
    fingerprint_code: `verify|runwriter|${TS}`,
    result_json: null,
    ...overrides,
  }
}

console.log(`Dev project: ${env.SUPABASE_URL}`)

async function main(): Promise<void> {
 try {
  // ────────────────────────────────────────────────────────────────────────
  // Setup: discover profile+persona, create two signal_application fixtures
  // ────────────────────────────────────────────────────────────────────────
  const { data: profiles, error: profErr } = await sb
    .from("client_profiles")
    .select("id, email")
    .limit(10)
  if (profErr || !profiles?.length) {
    throw new Error(`Could not find a client_profile: ${profErr?.message ?? "no rows"}`)
  }

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

  const { data: app1, error: app1Err } = await sb
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
  if (app1Err || !app1) {
    throw new Error(`signal_app fixture insert failed: ${app1Err?.message ?? "no row"}`)
  }
  testAppId = app1.id

  const { data: app2, error: app2Err } = await sb
    .from("signal_applications")
    .insert({
      profile_id: testProfileId,
      company_name: `${TEST_COMPANY} (#2)`,
      job_title: TEST_TITLE,
      location: "",
      job_url: "",
      application_status: "saved",
      interest_level: 1,
    })
    .select("id")
    .single()
  if (app2Err || !app2) {
    throw new Error(`signal_app fixture #2 insert failed: ${app2Err?.message ?? "no row"}`)
  }
  testAppId2 = app2.id
  console.log(`  created signal_app fixtures ${testAppId.slice(0, 8)}… + ${testAppId2.slice(0, 8)}…`)

  // ════════════════════════════════════════════════════════════════════════
  // ████ TEST 1: F2 SELF-HEAL — LOAD-BEARING ███████████████████████████████
  // ════════════════════════════════════════════════════════════════════════
  // This is the test that proves DD-26's two-write self-heal pattern works.
  // If this passes, the rest of D4 is incidental. If this fails, D4 ships
  // broken regardless of the other tests.
  //
  // Sequence:
  //   1a. createPositioningRun(signal_application_id=null) — asymmetric state:
  //       caller has the run id, but the row doesn't know its application yet.
  //   1b. linkSignalApplicationToRun(runId, appId) — fills in the link.
  //       Verify signal_application_id populated AND updated_at advanced.
  //   1c. linkSignalApplicationToRun(runId, appId) AGAIN with same id —
  //       idempotent. Verify ok=true, signal_application_id unchanged,
  //       updated_at ADVANCED (proves set_updated_at trigger fires on
  //       no-op UPDATE; the observability contract from DD-26).
  console.log("\n=== TEST 1: F2 self-heal (load-bearing) ===")
  {
    // Step 1a: create with signal_application_id=null
    const created = await createPositioningRun(sb, buildPayload({ signal_application_id: null }))
    if (created.error || !created.row) {
      fail("1a: createPositioningRun (self-heal step 1)", created.error)
      throw new Error("self-heal aborted at step 1a — cannot continue")
    }
    createdRunIds.push(created.row.id)
    const runId = created.row.id
    const createdUpdatedAt = created.row.updated_at

    if (created.row.signal_application_id !== null) {
      fail(
        "1a: signal_application_id should be null after create",
        String(created.row.signal_application_id),
      )
    } else {
      pass(`1a: row created with signal_application_id=null (id=${runId.slice(0, 8)}…)`)
    }

    // Wait so updated_at can advance measurably on the next UPDATE
    await new Promise((r) => setTimeout(r, 1100))

    // Step 1b: link
    const link1 = await linkSignalApplicationToRun(sb, runId, testAppId)
    if (!link1.ok) {
      fail("1b: first link failed", link1.error)
      throw new Error("self-heal aborted at step 1b")
    }
    const { data: afterLink, error: afterLinkErr } = await sb
      .from("positioning_runs_v2")
      .select("id, signal_application_id, updated_at")
      .eq("id", runId)
      .single()
    if (afterLinkErr || !afterLink) {
      fail("1b: readback after link", afterLinkErr?.message ?? "no row")
      throw new Error("self-heal aborted at step 1b readback")
    }
    if (afterLink.signal_application_id !== testAppId) {
      fail(
        "1b: link did not populate signal_application_id",
        `expected ${testAppId.slice(0, 8)}…, got ${afterLink.signal_application_id ?? "null"}`,
      )
    } else if (Date.parse(afterLink.updated_at) <= Date.parse(createdUpdatedAt)) {
      fail(
        "1b: updated_at did not advance after link UPDATE",
        `created=${createdUpdatedAt} after-link=${afterLink.updated_at}`,
      )
    } else {
      const advanceMs = Date.parse(afterLink.updated_at) - Date.parse(createdUpdatedAt)
      pass(`1b: link populated signal_application_id; updated_at advanced ${advanceMs}ms`)
    }
    const afterFirstLinkUpdatedAt = afterLink.updated_at

    // Wait again so the second UPDATE produces measurable advancement
    await new Promise((r) => setTimeout(r, 1100))

    // Step 1c: idempotent re-link with same id
    const link2 = await linkSignalApplicationToRun(sb, runId, testAppId)
    if (!link2.ok) {
      fail("1c: idempotent re-link failed", link2.error)
    } else {
      const { data: afterRelink, error: afterRelinkErr } = await sb
        .from("positioning_runs_v2")
        .select("id, signal_application_id, updated_at")
        .eq("id", runId)
        .single()
      if (afterRelinkErr || !afterRelink) {
        fail("1c: readback after re-link", afterRelinkErr?.message ?? "no row")
      } else if (afterRelink.signal_application_id !== testAppId) {
        fail(
          "1c: idempotent re-link mutated signal_application_id",
          `expected ${testAppId.slice(0, 8)}…, got ${afterRelink.signal_application_id ?? "null"}`,
        )
      } else if (Date.parse(afterRelink.updated_at) <= Date.parse(afterFirstLinkUpdatedAt)) {
        fail(
          "1c: updated_at did not advance on idempotent re-link (trigger observability lost — DD-26 contract violated)",
          `after-first-link=${afterFirstLinkUpdatedAt} after-relink=${afterRelink.updated_at}`,
        )
      } else {
        const advanceMs =
          Date.parse(afterRelink.updated_at) - Date.parse(afterFirstLinkUpdatedAt)
        pass(
          `1c: idempotent re-link; signal_application_id unchanged; updated_at advanced ${advanceMs}ms (set_updated_at fires on no-op UPDATE)`,
        )
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n=== createPositioningRun ===")
  // ════════════════════════════════════════════════════════════════════════

  // Test 2: happy path — full row returned with defaults applied
  {
    const r = await createPositioningRun(sb, buildPayload())
    if (r.error || !r.row) {
      fail("2: happy path", r.error)
    } else {
      createdRunIds.push(r.row.id)
      if (r.row.status !== "in_progress") fail("2: default status", r.row.status)
      else if (r.row.current_phase !== 1)
        fail("2: default current_phase", String(r.row.current_phase))
      else if (!r.row.created_at || !r.row.updated_at)
        fail("2: timestamps populated")
      else if (r.row.completed_at !== null)
        fail("2: completed_at should be null", String(r.row.completed_at))
      else
        pass(
          `2: happy path returns full row (id=${r.row.id.slice(0, 8)}… status=${r.row.status} phase=${r.row.current_phase})`,
        )
    }
  }

  // Test 3: missing profile_id guard
  {
    const r = await createPositioningRun(sb, buildPayload({ profile_id: "" }))
    if (!r.error || r.row !== null)
      fail("3: missing profile_id should error", `error=${r.error} row=${r.row}`)
    else if (r.error !== "missing profile_id")
      fail("3: wrong guard message", r.error)
    else pass("3: missing profile_id returns error")
  }

  // Test 4: missing persona_id guard
  {
    const r = await createPositioningRun(sb, buildPayload({ persona_id: "" }))
    if (!r.error || r.row !== null)
      fail("4: missing persona_id should error", `error=${r.error} row=${r.row}`)
    else if (r.error !== "missing persona_id")
      fail("4: wrong guard message", r.error)
    else pass("4: missing persona_id returns error")
  }

  // Test 5: missing fingerprint_hash guard
  {
    const r = await createPositioningRun(sb, buildPayload({ fingerprint_hash: "" }))
    if (!r.error || r.row !== null)
      fail("5: missing fingerprint_hash should error", `error=${r.error} row=${r.row}`)
    else if (r.error !== "missing fingerprint_hash")
      fail("5: wrong guard message", r.error)
    else pass("5: missing fingerprint_hash returns error")
  }

  // Test 6: missing fingerprint_code guard
  {
    const r = await createPositioningRun(sb, buildPayload({ fingerprint_code: "" }))
    if (!r.error || r.row !== null)
      fail("6: missing fingerprint_code should error", `error=${r.error} row=${r.row}`)
    else if (r.error !== "missing fingerprint_code")
      fail("6: wrong guard message", r.error)
    else pass("6: missing fingerprint_code returns error")
  }

  // Test 7: signal_application_id explicitly null is preserved (self-heal contract)
  {
    const r = await createPositioningRun(sb, buildPayload({ signal_application_id: null }))
    if (r.error || !r.row) {
      fail("7: signal_application_id null insert", r.error)
    } else {
      createdRunIds.push(r.row.id)
      if (r.row.signal_application_id !== null)
        fail(
          "7: row should have signal_application_id=null",
          String(r.row.signal_application_id),
        )
      else pass("7: explicit signal_application_id=null is preserved")
    }
  }

  // Test 8: phase_data.phase_1 stored as JSONB and round-trips faithfully
  {
    const caseAssignedAt = "2026-05-12T10:00:00.000Z"
    const r = await createPositioningRun(
      sb,
      buildPayload({
        phase_data: { phase_1: { case_assigned_at: caseAssignedAt } },
      }),
    )
    if (r.error || !r.row) {
      fail("8: phase_data insert", r.error)
    } else {
      createdRunIds.push(r.row.id)
      const stored = r.row.phase_data?.phase_1?.case_assigned_at
      if (stored !== caseAssignedAt)
        fail("8: phase_data round-trip", `expected ${caseAssignedAt}, got ${stored}`)
      else
        pass(
          `8: phase_data.phase_1 stored as JSONB and round-trips (case_assigned_at=${stored})`,
        )
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n=== linkSignalApplicationToRun ===")
  // ════════════════════════════════════════════════════════════════════════

  // Test 9: existing-link OVERWRITE — link to id A, then link to id B; B wins.
  // Per JSDoc: "latest caller is authoritative." Documenting it here in test
  // form so any future change to that contract will fail this test loudly.
  {
    const create = await createPositioningRun(
      sb,
      buildPayload({ signal_application_id: testAppId }),
    )
    if (create.error || !create.row) {
      fail("9: setup createPositioningRun", create.error)
    } else {
      createdRunIds.push(create.row.id)
      const runId = create.row.id
      if (create.row.signal_application_id !== testAppId) {
        fail(
          "9: setup sanity — row should start with testAppId",
          String(create.row.signal_application_id),
        )
      } else {
        const overwrite = await linkSignalApplicationToRun(sb, runId, testAppId2)
        if (!overwrite.ok) {
          fail("9: overwrite link failed", overwrite.error)
        } else {
          const { data: after } = await sb
            .from("positioning_runs_v2")
            .select("signal_application_id")
            .eq("id", runId)
            .single()
          if (after?.signal_application_id !== testAppId2)
            fail(
              "9: overwrite did not persist new id",
              `expected ${testAppId2.slice(0, 8)}…, got ${after?.signal_application_id ?? "null"}`,
            )
          else
            pass(
              "9: existing-link OVERWRITE — latest caller wins per JSDoc contract",
            )
        }
      }
    }
  }

  // Test 10: non-existent runId → 'run not found'
  {
    const nonExistent = "00000000-0000-4000-a000-000000000000"
    const r = await linkSignalApplicationToRun(sb, nonExistent, testAppId)
    if (r.ok) fail("10: non-existent runId should fail", "ok=true")
    else if (r.error !== "run not found") fail("10: wrong error", r.error)
    else pass("10: non-existent runId returns ok=false with 'run not found'")
  }

  // Test 11: empty runId guard
  {
    const r = await linkSignalApplicationToRun(sb, "", testAppId)
    if (r.ok) fail("11: empty runId should fail", "ok=true")
    else if (r.error !== "missing runId") fail("11: wrong guard message", r.error)
    else pass("11: empty runId returns 'missing runId'")
  }

  // Test 12: empty signalApplicationId guard
  {
    const r = await linkSignalApplicationToRun(
      sb,
      "00000000-0000-4000-a000-000000000000",
      "",
    )
    if (r.ok) fail("12: empty signalApplicationId should fail", "ok=true")
    else if (r.error !== "missing signalApplicationId")
      fail("12: wrong guard message", r.error)
    else pass("12: empty signalApplicationId returns 'missing signalApplicationId'")
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n=== appendPhase1Visit ===")
  // ════════════════════════════════════════════════════════════════════════

  // Test 13: phase_1 initialized but visits array absent → visits = [visit]
  {
    const create = await createPositioningRun(
      sb,
      buildPayload({
        phase_data: { phase_1: { case_assigned_at: new Date().toISOString() } },
      }),
    )
    if (create.error || !create.row) {
      fail("13: setup createPositioningRun", create.error)
    } else {
      createdRunIds.push(create.row.id)
      const runId = create.row.id
      const visit: Phase1Visit = {
        visited_at: new Date().toISOString(),
        action: "viewed",
      }
      const r = await appendPhase1Visit(sb, runId, visit)
      if (!r.ok) {
        fail("13: appendPhase1Visit (no visits)", r.error)
      } else {
        const { data: after } = await sb
          .from("positioning_runs_v2")
          .select("phase_data")
          .eq("id", runId)
          .single()
        const phaseData = after?.phase_data as PositioningRunV2PhaseData | undefined
        const visits = phaseData?.phase_1?.visits
        if (!Array.isArray(visits) || visits.length !== 1)
          fail(
            "13: visits array not initialized correctly",
            JSON.stringify(visits),
          )
        else if (
          visits[0].action !== "viewed" ||
          visits[0].visited_at !== visit.visited_at
        )
          fail("13: visit not stored correctly", JSON.stringify(visits[0]))
        else
          pass(
            "13: appendPhase1Visit initializes visits=[visit] when array absent",
          )
      }
    }
  }

  // Test 14: phase_1 + existing visits → appends; order and existing entries preserved
  {
    const initialVisit: Phase1Visit = {
      visited_at: "2026-05-12T10:00:00.000Z",
      action: "viewed",
    }
    const create = await createPositioningRun(
      sb,
      buildPayload({
        phase_data: {
          phase_1: {
            case_assigned_at: new Date().toISOString(),
            visits: [initialVisit],
          },
        },
      }),
    )
    if (create.error || !create.row) {
      fail("14: setup createPositioningRun", create.error)
    } else {
      createdRunIds.push(create.row.id)
      const runId = create.row.id
      const newVisit: Phase1Visit = {
        visited_at: "2026-05-12T11:00:00.000Z",
        action: "saved_for_later",
      }
      const r = await appendPhase1Visit(sb, runId, newVisit)
      if (!r.ok) {
        fail("14: appendPhase1Visit (existing array)", r.error)
      } else {
        const { data: after } = await sb
          .from("positioning_runs_v2")
          .select("phase_data")
          .eq("id", runId)
          .single()
        const phaseData = after?.phase_data as PositioningRunV2PhaseData | undefined
        const visits = phaseData?.phase_1?.visits
        if (!Array.isArray(visits) || visits.length !== 2)
          fail("14: visits length", `expected 2, got ${visits?.length}`)
        else if (
          visits[0].action !== "viewed" ||
          visits[1].action !== "saved_for_later"
        )
          fail("14: visit order/content wrong", JSON.stringify(visits))
        else
          pass(
            "14: appendPhase1Visit appends to existing array, preserving order",
          )
      }
    }
  }

  // Test 15: missing phase_1 → 'phase_data.phase_1 not initialized' error
  // (F2 invariant — createPositioningRun is the only path that may seed phase_1)
  {
    const create = await createPositioningRun(sb, buildPayload({ phase_data: {} }))
    if (create.error || !create.row) {
      fail("15: setup createPositioningRun", create.error)
    } else {
      createdRunIds.push(create.row.id)
      const visit: Phase1Visit = {
        visited_at: new Date().toISOString(),
        action: "viewed",
      }
      const r = await appendPhase1Visit(sb, create.row.id, visit)
      if (r.ok) fail("15: should error on missing phase_1", "ok=true")
      else if (!r.error?.includes("phase_data.phase_1 not initialized"))
        fail("15: wrong error message", r.error)
      else
        pass(
          "15: missing phase_1 returns 'phase_data.phase_1 not initialized' error",
        )
    }
  }

  // Test 16: non-existent runId → 'run not found'
  {
    const nonExistent = "00000000-0000-4000-a000-000000000000"
    const visit: Phase1Visit = {
      visited_at: new Date().toISOString(),
      action: "viewed",
    }
    const r = await appendPhase1Visit(sb, nonExistent, visit)
    if (r.ok) fail("16: non-existent runId should fail", "ok=true")
    else if (r.error !== "run not found") fail("16: wrong error", r.error)
    else pass("16: non-existent runId returns 'run not found'")
  }

  // Test 17: empty runId guard
  {
    const visit: Phase1Visit = {
      visited_at: new Date().toISOString(),
      action: "viewed",
    }
    const r = await appendPhase1Visit(sb, "", visit)
    if (r.ok) fail("17: empty runId should fail", "ok=true")
    else if (r.error !== "missing runId")
      fail("17: wrong guard message", r.error)
    else pass("17: empty runId returns 'missing runId'")
  }

  // Test 18: visit missing visited_at → 'invalid visit' error
  {
    const badVisit: Phase1Visit = { visited_at: "", action: "viewed" }
    const r = await appendPhase1Visit(
      sb,
      "00000000-0000-4000-a000-000000000000",
      badVisit,
    )
    if (r.ok) fail("18: missing visited_at should fail", "ok=true")
    else if (!r.error?.includes("invalid visit"))
      fail("18: wrong guard message", r.error)
    else pass("18: missing visited_at returns 'invalid visit' error")
  }

  // Test 19: visit missing action → 'invalid visit' error
  // (Cast through unknown because action is typed as Phase1VisitAction enum;
  // we're deliberately exercising the runtime guard with an out-of-type value
  // that an unchecked caller could produce.)
  {
    const badVisit = {
      visited_at: new Date().toISOString(),
      action: "",
    } as unknown as Phase1Visit
    const r = await appendPhase1Visit(
      sb,
      "00000000-0000-4000-a000-000000000000",
      badVisit,
    )
    if (r.ok) fail("19: missing action should fail", "ok=true")
    else if (!r.error?.includes("invalid visit"))
      fail("19: wrong guard message", r.error)
    else pass("19: missing action returns 'invalid visit' error")
  }
 } catch (e) {
  console.error(`\nFatal: ${(e as Error).message}`)
  failures.push(`fatal: ${(e as Error).message}`)
 } finally {
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n=== Cleanup ===")
  // ────────────────────────────────────────────────────────────────────────
  let runsDeleted = 0
  for (const id of createdRunIds) {
    const { error } = await sb.from("positioning_runs_v2").delete().eq("id", id)
    if (error) {
      console.log(`  ✗ FAILED to delete positioning_run ${id}: ${error.message}`)
      console.log(
        `     MANUAL CLEANUP: DELETE FROM public.positioning_runs_v2 WHERE id = '${id}';`,
      )
      failures.push(`cleanup-run-${id}`)
    } else {
      runsDeleted++
    }
  }
  if (createdRunIds.length > 0) {
    console.log(
      `  ✓ deleted ${runsDeleted}/${createdRunIds.length} positioning_runs_v2 rows`,
    )
  }
  if (testAppId) {
    const { error } = await sb
      .from("signal_applications")
      .delete()
      .eq("id", testAppId)
    if (error) {
      console.log(`  ✗ FAILED to delete signal_app ${testAppId}: ${error.message}`)
      console.log(
        `     MANUAL CLEANUP: DELETE FROM public.signal_applications WHERE id = '${testAppId}';`,
      )
      failures.push("cleanup signal_app")
    } else {
      console.log(`  ✓ deleted signal_app ${testAppId.slice(0, 8)}…`)
    }
  }
  if (testAppId2) {
    const { error } = await sb
      .from("signal_applications")
      .delete()
      .eq("id", testAppId2)
    if (error) {
      console.log(`  ✗ FAILED to delete signal_app ${testAppId2}: ${error.message}`)
      console.log(
        `     MANUAL CLEANUP: DELETE FROM public.signal_applications WHERE id = '${testAppId2}';`,
      )
      failures.push("cleanup signal_app2")
    } else {
      console.log(`  ✓ deleted signal_app ${testAppId2.slice(0, 8)}…`)
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
