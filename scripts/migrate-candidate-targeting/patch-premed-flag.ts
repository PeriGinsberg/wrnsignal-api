// scripts/migrate-candidate-targeting/patch-premed-flag.ts
//
// Patch script for the PreMed gap surfaced after prod migration. The main
// migration used "latest JobFit run" to determine JobFamily, which missed
// historical PreMed candidates whose most-recent run was a different family.
// This patch uses "any-run-in-history" — matches DD-04's spec intent better.
//
// Scope (locked):
//   - ONLY updates candidate_targeting.status_premed
//   - Does NOT touch primary_lane (a pre-med candidate currently targeting
//     consulting should stay primary_lane='consulting' with status_premed
//     added as an independent indicator — that's the architectural intent
//     behind moving PreMed out of the lane enum)
//   - Does NOT touch any other column
//   - Does NOT INSERT new rows (only patches existing rows)
//
// Idempotent: re-running has no effect after the first run because the
// UPDATE has a `.eq('status_premed', false)` filter — only rows where the
// flag is currently false get touched.
//
// Run:
//   DEV (default):
//     npx tsx scripts/migrate-candidate-targeting/patch-premed-flag.ts
//   PROD:
//     MIGRATION_CONFIRM_PROD=1 npx tsx scripts/migrate-candidate-targeting/patch-premed-flag.ts .env.production.local
//
// Operational guards (same as main migration):
//   - Write-restricted Supabase client (Proxy only allows writes to
//     candidate_targeting; everything else throws on mutation methods)
//   - Default env: dev. Prod requires explicit env file path AND
//     MIGRATION_CONFIRM_PROD=1 to proceed.
//   - Audit log at start and end (reads, writes, eligible profiles,
//     already-flagged, newly-flagged)
//   - Service-role key never logged

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

// ============================================================================
// Env + CLI args
// ============================================================================

const ENV_PATH = process.argv[2] ?? ".env.development.local"
const IS_PROD = ENV_PATH.includes("production")

function loadEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const text = readFileSync(path, "utf8")
  const out: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const i = trimmed.indexOf("=")
    if (i < 0) continue
    out[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim()
  }
  return out
}

const envTarget = loadEnv(ENV_PATH)
const SUPABASE_URL = envTarget.SUPABASE_URL
const SERVICE_ROLE_KEY = envTarget.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    `Missing Supabase credentials in ${ENV_PATH} ` +
      `(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required).`,
  )
  process.exit(1)
}

// Prod safety gate (same pattern as run-migration.ts)
if (IS_PROD && process.env.MIGRATION_CONFIRM_PROD !== "1") {
  console.error("")
  console.error("⚠ PROD PATCH DETECTED")
  console.error(`  Env file: ${ENV_PATH}`)
  console.error(`  Project:  ${SUPABASE_URL}`)
  console.error("")
  console.error("To proceed, re-run with explicit confirmation:")
  console.error(
    `  MIGRATION_CONFIRM_PROD=1 npx tsx scripts/migrate-candidate-targeting/patch-premed-flag.ts ${ENV_PATH}`,
  )
  console.error("")
  process.exit(1)
}

// ============================================================================
// Write-restricted Supabase client — same Proxy as run-migration.ts.
// Only candidate_targeting writes permitted. All other tables: SELECT-only.
// ============================================================================

const WRITE_ALLOWED_TABLES = new Set(["candidate_targeting"])
const MUTATION_METHODS = new Set(["insert", "update", "delete", "upsert"])

function makePatchClient(client: SupabaseClient): SupabaseClient {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "from") {
        return (table: string) => {
          const builder = target.from(table)
          return new Proxy(builder, {
            get(b, m) {
              if (
                typeof m === "string" &&
                MUTATION_METHODS.has(m) &&
                !WRITE_ALLOWED_TABLES.has(table)
              ) {
                throw new Error(
                  `PATCH GUARD: .${m}() on table '${table}' not permitted. ` +
                    `Only candidate_targeting writes allowed.`,
                )
              }
              const v = Reflect.get(b, m)
              return typeof v === "function" ? v.bind(b) : v
            },
          })
        }
      }
      if (prop === "rpc") {
        throw new Error(
          "PATCH GUARD: .rpc() blocked. " +
            "Patch writes go through the candidate_targeting table API only.",
        )
      }
      return Reflect.get(target, prop)
    },
  })
}

const rawSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const supabase = makePatchClient(rawSupabase)

// Audit counters
let readCount = 0
let writeCount = 0
function trackRead(label: string): void {
  readCount++
  console.log(`  [read #${readCount}] ${label}`)
}

// ============================================================================
// Step 1: find profile_ids with ANY successful PreMed JobFit run
// ============================================================================

async function findPremedProfileIds(): Promise<Set<string>> {
  // Pull all successful jobfit_runs, filter for JobFamily=PreMed client-side.
  // Supabase JS JSON-path filtering exists but client-side is more readable
  // and ~755 rows is fine to iterate.
  const { data, error } = await supabase
    .from("jobfit_runs")
    .select("client_profile_id, result_json")
    .neq("verdict", "error")
  trackRead("jobfit_runs (all successful, scanning for PreMed)")
  if (error) throw new Error(`jobfit_runs select failed: ${error.message}`)

  const premedProfiles = new Set<string>()
  for (const row of (data ?? []) as Array<{
    client_profile_id: string
    result_json: Record<string, unknown> | null
  }>) {
    const sig = (row.result_json as { job_signals?: { jobFamily?: string } })
      ?.job_signals
    if (sig?.jobFamily === "PreMed") {
      premedProfiles.add(row.client_profile_id)
    }
  }
  return premedProfiles
}

// ============================================================================
// Step 2: classify candidate_targeting rows for those profiles
// ============================================================================

type TargetingRow = {
  profile_id: string
  status_premed: boolean
}

async function classifyTargetingRows(
  profileIds: string[],
): Promise<{
  alreadyTrue: TargetingRow[]
  needsUpdate: TargetingRow[]
  missing: string[] // profile_ids without a candidate_targeting row
}> {
  if (profileIds.length === 0) {
    return { alreadyTrue: [], needsUpdate: [], missing: [] }
  }
  const { data, error } = await supabase
    .from("candidate_targeting")
    .select("profile_id, status_premed")
    .in("profile_id", profileIds)
  trackRead(`candidate_targeting for ${profileIds.length} PreMed profiles`)
  if (error) throw new Error(`candidate_targeting select failed: ${error.message}`)

  const rows = (data ?? []) as TargetingRow[]
  const foundProfileIds = new Set(rows.map((r) => r.profile_id))
  const missing = profileIds.filter((id) => !foundProfileIds.has(id))

  const alreadyTrue = rows.filter((r) => r.status_premed === true)
  const needsUpdate = rows.filter((r) => r.status_premed === false)

  return { alreadyTrue, needsUpdate, missing }
}

// ============================================================================
// Step 3: UPDATE status_premed = true on rows that currently have it false
// ============================================================================

async function applyPatch(profileIdsToUpdate: string[]): Promise<{
  updated: number
  error?: string
}> {
  if (profileIdsToUpdate.length === 0) return { updated: 0 }

  // Idempotency: also filter by status_premed = false so a re-run produces
  // zero writes if the rows are already flagged.
  const { data, error } = await supabase
    .from("candidate_targeting")
    .update({ status_premed: true })
    .in("profile_id", profileIdsToUpdate)
    .eq("status_premed", false)
    .select("profile_id")
  if (error) return { updated: 0, error: error.message }

  const updated = (data ?? []).length
  writeCount += updated
  return { updated }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const startedAt = new Date().toISOString()
  console.log("============================================================")
  console.log("PREMED FLAG PATCH (status_premed = true)")
  console.log("============================================================")
  console.log(`Env file:       ${ENV_PATH}`)
  console.log(`Project URL:    ${SUPABASE_URL}`)
  console.log(`Environment:    ${IS_PROD ? "PROD" : "DEV"}`)
  console.log(`Started:        ${startedAt}`)
  console.log(`Write target:   candidate_targeting (ONLY — Proxy enforced)`)
  console.log(`Scope:          status_premed = true (no other columns touched)`)
  if (IS_PROD) console.log(`Confirm flag:   MIGRATION_CONFIRM_PROD=1`)
  console.log("")

  // Step 1
  console.log("Finding profiles with any PreMed JobFit run…")
  const premedProfiles = await findPremedProfileIds()
  console.log(`  Eligible (any-run-history): ${premedProfiles.size} profiles`)

  // Step 2
  console.log("Classifying their candidate_targeting rows…")
  const { alreadyTrue, needsUpdate, missing } = await classifyTargetingRows([
    ...premedProfiles,
  ])
  console.log(`  Already status_premed=true: ${alreadyTrue.length}`)
  console.log(`  Need update (false → true): ${needsUpdate.length}`)
  console.log(`  Missing targeting row:      ${missing.length}`)
  console.log("")

  // Step 3
  console.log("Applying patch…")
  const result = await applyPatch(needsUpdate.map((r) => r.profile_id))
  if (result.error) {
    console.error(`  UPDATE failed: ${result.error}`)
    console.log("")
    console.log("============================================================")
    console.log("AUDIT — end of run (with error)")
    console.log("============================================================")
    console.log(`  Reads issued:        ${readCount}`)
    console.log(`  Writes issued:       ${writeCount}`)
    process.exit(1)
  }
  console.log(`  Updated: ${result.updated} rows`)

  // Write transcript
  const resultsDir = join(
    "scripts",
    "migrate-candidate-targeting",
    "results",
  )
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const envSlug = IS_PROD ? "prod" : "dev"
  const outPath = join(resultsDir, `patch-premed-${envSlug}-${ts}.txt`)

  const lines: string[] = []
  lines.push("============================================================")
  lines.push("PREMED FLAG PATCH — transcript")
  lines.push("============================================================")
  lines.push(`Env file:      ${ENV_PATH}`)
  lines.push(`Project URL:   ${SUPABASE_URL}`)
  lines.push(`Environment:   ${IS_PROD ? "PROD" : "DEV"}`)
  lines.push(`Started:       ${startedAt}`)
  lines.push(`Finished:      ${new Date().toISOString()}`)
  lines.push(`Read count:    ${readCount}`)
  lines.push(`Write count:   ${writeCount}`)
  lines.push(`Write target:  candidate_targeting (ONLY — Proxy enforced)`)
  lines.push(`Scope:         status_premed = true (no other columns touched)`)
  lines.push("")
  lines.push(`Eligible profiles (any-run-history):  ${premedProfiles.size}`)
  lines.push(`  Already status_premed=true:         ${alreadyTrue.length}`)
  lines.push(`  Updated (false → true):             ${result.updated}`)
  lines.push(`  Missing candidate_targeting row:    ${missing.length}`)
  lines.push("")
  if (missing.length > 0) {
    lines.push("Missing-row profile_ids:")
    for (const id of missing) lines.push(`  ${id}`)
    lines.push("")
  }
  lines.push("Updated profile_ids:")
  for (const r of needsUpdate) lines.push(`  ${r.profile_id}`)
  writeFileSync(outPath, lines.join("\n"), "utf8")
  console.log("")
  console.log(`Transcript: ${outPath}`)

  // End audit
  console.log("")
  console.log("============================================================")
  console.log("AUDIT — end of run")
  console.log("============================================================")
  console.log(`  Environment:                ${IS_PROD ? "PROD" : "DEV"}`)
  console.log(`  Reads issued:               ${readCount}`)
  console.log(`  Writes issued:              ${writeCount}`)
  console.log(`  Write target:               candidate_targeting (ONLY — enforced)`)
  console.log(`  Eligible profiles:          ${premedProfiles.size}`)
  console.log(`  Already flagged:            ${alreadyTrue.length}`)
  console.log(`  Newly flagged:              ${result.updated}`)
  console.log(`  Missing targeting row:      ${missing.length}`)
}

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : String(e))
  console.error(
    `Audit: reads = ${readCount}, writes = ${writeCount} (target: candidate_targeting only)`,
  )
  process.exit(1)
})
