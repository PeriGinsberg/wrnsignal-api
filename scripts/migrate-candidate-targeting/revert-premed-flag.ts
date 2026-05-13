// scripts/migrate-candidate-targeting/revert-premed-flag.ts
//
// Revert the PreMed flag patch (DD-22) after diagnosis revealed all 4 flagged
// profiles got status_premed=true from unreliable historical JobFit data.
// See investigation in scripts/migrate-candidate-targeting/investigate-premed-misclass.mjs
// and runlog DD-23.
//
// Scope (locked):
//   - UPDATE status_premed = false
//   - WHERE status_premed = true AND source = 'migration'
//   - Only touches the status_premed column
//   - Does NOT touch primary_lane, source, or any other column
//   - Does NOT INSERT, DELETE, or affect non-matching rows
//
// Idempotent: re-running has no effect after the first run because the
// WHERE status_premed=true filter only matches rows that haven't been
// reverted yet.
//
// Run:
//   DEV (default):
//     npx tsx scripts/migrate-candidate-targeting/revert-premed-flag.ts
//   PROD:
//     MIGRATION_CONFIRM_PROD=1 npx tsx scripts/migrate-candidate-targeting/revert-premed-flag.ts .env.production.local
//
// Operational guards (same as run-migration.ts and patch-premed-flag.ts):
//   - Write-restricted Supabase client (Proxy only allows writes to
//     candidate_targeting; everything else throws on mutation methods)
//   - Default env: dev. Prod requires explicit env file path AND
//     MIGRATION_CONFIRM_PROD=1 to proceed.
//   - Audit log: reads, writes, eligible count, reverted count
//   - Service-role key never logged
//   - Pre-revert read confirms which profiles are about to change

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

// Prod safety gate
if (IS_PROD && process.env.MIGRATION_CONFIRM_PROD !== "1") {
  console.error("")
  console.error("⚠ PROD REVERT DETECTED")
  console.error(`  Env file: ${ENV_PATH}`)
  console.error(`  Project:  ${SUPABASE_URL}`)
  console.error("")
  console.error("To proceed, re-run with explicit confirmation:")
  console.error(
    `  MIGRATION_CONFIRM_PROD=1 npx tsx scripts/migrate-candidate-targeting/revert-premed-flag.ts ${ENV_PATH}`,
  )
  console.error("")
  process.exit(1)
}

// ============================================================================
// Write-restricted Supabase client — only candidate_targeting writes permitted.
// ============================================================================

const WRITE_ALLOWED_TABLES = new Set(["candidate_targeting"])
const MUTATION_METHODS = new Set(["insert", "update", "delete", "upsert"])

function makeRevertClient(client: SupabaseClient): SupabaseClient {
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
                  `REVERT GUARD: .${m}() on table '${table}' not permitted. ` +
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
          "REVERT GUARD: .rpc() blocked. " +
            "Revert writes go through the candidate_targeting table API only.",
        )
      }
      return Reflect.get(target, prop)
    },
  })
}

const rawSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const supabase = makeRevertClient(rawSupabase)

// Audit counters
let readCount = 0
let writeCount = 0
function trackRead(label: string): void {
  readCount++
  console.log(`  [read #${readCount}] ${label}`)
}

// ============================================================================
// Step 1: read eligible rows for audit (what's about to change)
// ============================================================================

type EligibleRow = {
  profile_id: string
  primary_lane: string
}

async function fetchEligibleRows(): Promise<EligibleRow[]> {
  const { data, error } = await supabase
    .from("candidate_targeting")
    .select("profile_id, primary_lane")
    .eq("status_premed", true)
    .eq("source", "migration")
  trackRead("candidate_targeting (status_premed=true AND source='migration')")
  if (error) throw new Error(`select failed: ${error.message}`)
  return (data ?? []) as EligibleRow[]
}

// ============================================================================
// Step 2: UPDATE status_premed = false on eligible rows
// ============================================================================

async function applyRevert(): Promise<{ updated: number; error?: string }> {
  const { data, error } = await supabase
    .from("candidate_targeting")
    .update({ status_premed: false })
    .eq("status_premed", true)
    .eq("source", "migration")
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
  console.log("PREMED FLAG REVERT (status_premed = false)")
  console.log("============================================================")
  console.log(`Env file:       ${ENV_PATH}`)
  console.log(`Project URL:    ${SUPABASE_URL}`)
  console.log(`Environment:    ${IS_PROD ? "PROD" : "DEV"}`)
  console.log(`Started:        ${startedAt}`)
  console.log(`Write target:   candidate_targeting (ONLY — Proxy enforced)`)
  console.log(`Scope:          status_premed=true AND source='migration' → false`)
  if (IS_PROD) console.log(`Confirm flag:   MIGRATION_CONFIRM_PROD=1`)
  console.log("")

  // Step 1: audit-read eligible rows
  console.log("Finding rows to revert (status_premed=true AND source='migration')…")
  const eligible = await fetchEligibleRows()
  console.log(`  Eligible: ${eligible.length}`)
  if (eligible.length > 0) {
    console.log("  Will revert:")
    for (const r of eligible) {
      console.log(`    ${r.profile_id} (current lane: ${r.primary_lane})`)
    }
  }
  console.log("")

  // Step 2: revert
  console.log("Applying revert…")
  const result = await applyRevert()
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
  console.log(`  Reverted: ${result.updated} rows`)

  // Transcript
  const resultsDir = join(
    "scripts",
    "migrate-candidate-targeting",
    "results",
  )
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const envSlug = IS_PROD ? "prod" : "dev"
  const outPath = join(resultsDir, `revert-premed-${envSlug}-${ts}.txt`)

  const lines: string[] = []
  lines.push("============================================================")
  lines.push("PREMED FLAG REVERT — transcript")
  lines.push("============================================================")
  lines.push(`Env file:      ${ENV_PATH}`)
  lines.push(`Project URL:   ${SUPABASE_URL}`)
  lines.push(`Environment:   ${IS_PROD ? "PROD" : "DEV"}`)
  lines.push(`Started:       ${startedAt}`)
  lines.push(`Finished:      ${new Date().toISOString()}`)
  lines.push(`Read count:    ${readCount}`)
  lines.push(`Write count:   ${writeCount}`)
  lines.push(`Write target:  candidate_targeting (ONLY — Proxy enforced)`)
  lines.push(`Scope:         status_premed=true AND source='migration' → false`)
  lines.push("")
  lines.push(`Eligible rows: ${eligible.length}`)
  lines.push(`Reverted:      ${result.updated}`)
  lines.push("")
  if (eligible.length > 0) {
    lines.push("Reverted profile_ids (with their preserved lane):")
    for (const r of eligible) lines.push(`  ${r.profile_id} (lane=${r.primary_lane})`)
  }
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
  console.log(`  Eligible rows:              ${eligible.length}`)
  console.log(`  Reverted:                   ${result.updated}`)
}

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : String(e))
  console.error(
    `Audit: reads = ${readCount}, writes = ${writeCount} (target: candidate_targeting only)`,
  )
  process.exit(1)
})
