// tests/positioning-v2/phase2/phase2-run-lookup-check.ts
//
// Unit test for lib/positioning/v2/phase2/phase2RunLookup.ts
//
// Run:
//   npx tsx tests/positioning-v2/phase2/phase2-run-lookup-check.ts
//
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.development.local
// (matches Phase 1 test env-loading pattern). Hits dev DB. Creates + cleans
// up fixtures.

import { readFileSync } from "node:fs"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { findExistingPhase2Run } from "@/lib/positioning/v2/phase2/phase2RunLookup"
import type { PhaseTwoState } from "@/lib/positioning/v2/phase2/types"

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

const env = Object.fromEntries(
  readFileSync(".env.development.local", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=")
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const supabase: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

// Track created fixtures for cleanup
const createdPhase2RunIds: string[] = []
let fixtureProfileId: string | null = null
let fixturePersonaId: string | null = null
let fixturePositioningRunId: string | null = null
let fixtureJobfitRunId: string | null = null

const minimalState: PhaseTwoState = {
  items: [],
  current_section_id: null,
  selection_screen_seen: false,
  completion_offered: false,
  completion_decision: null,
}

async function setupFixtures(): Promise<void> {
  // Find a dev (profile, persona, jobfit_run) trio where all three exist.
  // We start from jobfit_runs because that's the scarcest table — most
  // profiles have personas, but only some have jobfit_runs. We then
  // check the profile has at least one persona.
  const { data: jrs } = await supabase
    .from("jobfit_runs")
    .select("id, client_profile_id")
    .limit(20)
  if (!jrs || jrs.length === 0) {
    throw new Error("No dev jobfit_runs found; cannot run test")
  }

  for (const jr of jrs as Array<{ id: string; client_profile_id: string }>) {
    const { data: persona } = await supabase
      .from("client_personas")
      .select("id")
      .eq("profile_id", jr.client_profile_id)
      .limit(1)
      .maybeSingle<{ id: string }>()
    if (persona) {
      fixtureJobfitRunId = jr.id
      fixtureProfileId = jr.client_profile_id
      fixturePersonaId = persona.id
      break
    }
  }
  if (!fixtureJobfitRunId || !fixtureProfileId || !fixturePersonaId) {
    throw new Error(
      "No dev (profile, persona, jobfit_run) trio found; cannot run test",
    )
  }

  // Create a positioning_run_v2 (Case B) to anchor the phase2_run lookups
  const { data: posRun, error: posErr } = await supabase
    .from("positioning_runs_v2")
    .insert({
      profile_id: fixtureProfileId,
      persona_id: fixturePersonaId,
      jobfit_run_id: fixtureJobfitRunId,
      job_title: "Test Job",
      job_company: "Test Co",
      job_description: "test JD body",
      case_assigned: "B",
      case_reasoning: "test fixture",
      fingerprint_hash: "test-fixture-" + Date.now(),
      fingerprint_code: "test-code",
      phase_data: {},
    })
    .select("id")
    .single<{ id: string }>()
  if (posErr || !posRun) {
    throw new Error(`positioning_run fixture create failed: ${posErr?.message}`)
  }
  fixturePositioningRunId = posRun.id
}

async function createPhase2Run(
  status: "in_progress" | "completed" = "in_progress",
): Promise<string> {
  const { data, error } = await supabase
    .from("phase2_runs")
    .insert({
      positioning_run_id: fixturePositioningRunId!,
      profile_id: fixtureProfileId!,
      persona_id: fixturePersonaId!,
      case_letter: "B",
      state: minimalState,
      status,
    })
    .select("id")
    .single<{ id: string }>()
  if (error || !data) {
    throw new Error(`phase2_run create failed: ${error?.message}`)
  }
  createdPhase2RunIds.push(data.id)
  return data.id
}

async function cleanup(): Promise<void> {
  console.log("\n=== Cleanup ===")
  for (const id of createdPhase2RunIds) {
    const { error } = await supabase.from("phase2_runs").delete().eq("id", id)
    if (error) {
      console.log(`  ✗ delete phase2_run ${id.slice(0, 8)}… error=${error.message}`)
    } else {
      console.log(`  ✓ deleted phase2_run ${id.slice(0, 8)}…`)
    }
  }
  if (fixturePositioningRunId) {
    const { error } = await supabase
      .from("positioning_runs_v2")
      .delete()
      .eq("id", fixturePositioningRunId)
    if (error) {
      console.log(`  ✗ delete positioning_run error=${error.message}`)
    } else {
      console.log(`  ✓ deleted positioning_run ${fixturePositioningRunId.slice(0, 8)}…`)
    }
  }
}

async function main() {
  console.log("=== findExistingPhase2Run ===")

  try {
    await setupFixtures()

    // Test 1: no phase2_run exists → returns null
    {
      const result = await findExistingPhase2Run(
        supabase,
        fixturePositioningRunId!,
        fixturePersonaId!,
      )
      check(
        "1: no phase2_run exists → row=null, error=null",
        result.row === null && result.error === null,
        `got row=${result.row?.id ?? null}, error=${result.error}`,
      )
    }

    // Test 2: single in_progress row → returns that row
    {
      const id = await createPhase2Run("in_progress")
      const result = await findExistingPhase2Run(
        supabase,
        fixturePositioningRunId!,
        fixturePersonaId!,
      )
      check(
        "2: single in_progress row → returns it",
        result.row?.id === id,
        `expected ${id}, got ${result.row?.id ?? null}`,
      )
      check(
        "2: row.status === 'in_progress'",
        result.row?.status === "in_progress",
        `got ${result.row?.status}`,
      )
    }

    // Test 3: completed phase2_run does NOT match
    {
      // Cleanup the in_progress row first so we test purely a completed-only state
      const inProgressId = createdPhase2RunIds[createdPhase2RunIds.length - 1]
      await supabase.from("phase2_runs").delete().eq("id", inProgressId)
      createdPhase2RunIds.pop()

      await createPhase2Run("completed")
      const result = await findExistingPhase2Run(
        supabase,
        fixturePositioningRunId!,
        fixturePersonaId!,
      )
      check(
        "3: completed phase2_run is NOT returned (status filter)",
        result.row === null,
        `expected null, got ${result.row?.id ?? null}`,
      )
    }

    // Test 4: multiple in_progress rows → returns most recent, logs warning
    {
      const olderId = await createPhase2Run("in_progress")
      // Brief delay to ensure created_at ordering
      await new Promise((r) => setTimeout(r, 50))
      const newerId = await createPhase2Run("in_progress")

      const result = await findExistingPhase2Run(
        supabase,
        fixturePositioningRunId!,
        fixturePersonaId!,
      )
      check(
        "4: multiple in_progress rows → returns most recent",
        result.row?.id === newerId,
        `expected ${newerId} (newer), got ${result.row?.id ?? null} (older was ${olderId})`,
      )
    }
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
  console.error("Test crashed:", e)
  process.exit(1)
})
