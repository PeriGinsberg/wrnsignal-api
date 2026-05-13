// scripts/migrate-candidate-targeting/run-migration.ts
//
// Backfill candidate_targeting rows for client_profiles missing one.
// Idempotent: skips profiles with an existing targeting row.
//
// Run:
//   DEV (default):
//     npx tsx scripts/migrate-candidate-targeting/run-migration.ts
//   PROD (requires explicit confirmation):
//     MIGRATION_CONFIRM_PROD=1 npx tsx scripts/migrate-candidate-targeting/run-migration.ts .env.production.local
//
// Per-profile pipeline:
//   1. Skip if candidate_targeting row already exists (idempotent re-run safe)
//   2. Anonymize target_roles + resume_text (PII out, signal preserved)
//   3. Run Claude Haiku inference (locked prompt; DD-15)
//   4. Apply post-inference guards:
//      - PreMed dual-write (DD-04): JobFamily=PreMed → force lane=healthcare
//        AND status_premed=true regardless of LLM output
//      - Null-sublane guard (DD-20): non-Other lane with sublane=null →
//        first sub-lane in lane + downgrade confidence to 'low'
//      - Empty-other-description fallback: lane=other with no description →
//        synthesize one (defensive; DB CHECK would otherwise reject)
//   5. Derive career_stage from current_status + yearsExperienceApprox
//      (deterministic via deriveCareerStage from lib/candidateTargeting.ts)
//   6. INSERT candidate_targeting row with source='migration',
//      career_stage_locked_by='inferred'
//
// Operational guards:
//   - Write-restricted Supabase client (Proxy only allows writes to
//     candidate_targeting; everything else throws on mutation methods)
//   - Anonymization applied before LLM call
//   - Service-role key never logged or written to results file
//   - Default env: dev. Prod requires explicit env file path AND
//     MIGRATION_CONFIRM_PROD=1 to proceed.
//   - Audit log at start and end (reads, writes, profiles processed,
//     errors, applied-guards breakdown)
//   - Results saved to scripts/migrate-candidate-targeting/results/
//     migration-<env>-<ISO>.txt (gitignored)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import { LANES } from "@/lib/laneTaxonomy"
import {
  upsertCandidateTargeting,
  getCandidateTargeting,
  deriveCareerStage,
  type CandidateTargetingPayload,
} from "@/lib/candidateTargeting"
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseInferenceOutput,
  type InferenceInput,
  type InferenceOutput,
} from "./inference-prompt"

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
const envLocal = loadEnv(".env.local")

const SUPABASE_URL = envTarget.SUPABASE_URL
const SERVICE_ROLE_KEY = envTarget.SUPABASE_SERVICE_ROLE_KEY
const ANTHROPIC_API_KEY =
  envTarget.ANTHROPIC_API_KEY ??
  envLocal.ANTHROPIC_API_KEY ??
  process.env.ANTHROPIC_API_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    `Missing Supabase credentials in ${ENV_PATH} ` +
      `(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required).`,
  )
  process.exit(1)
}
if (!ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY.")
  process.exit(1)
}

// Prod safety gate
if (IS_PROD && process.env.MIGRATION_CONFIRM_PROD !== "1") {
  console.error("")
  console.error("⚠ PROD MIGRATION DETECTED")
  console.error(`  Env file: ${ENV_PATH}`)
  console.error(`  Project:  ${SUPABASE_URL}`)
  console.error("")
  console.error("To proceed, re-run with explicit confirmation:")
  console.error(`  MIGRATION_CONFIRM_PROD=1 npx tsx scripts/migrate-candidate-targeting/run-migration.ts ${ENV_PATH}`)
  console.error("")
  process.exit(1)
}

const MODEL = "claude-haiku-4-5-20251001"

// ============================================================================
// Write-restricted Supabase client — only candidate_targeting writes permitted.
// All other tables: SELECT-only. .rpc() blocked entirely.
// ============================================================================

const WRITE_ALLOWED_TABLES = new Set(["candidate_targeting"])
const MUTATION_METHODS = new Set(["insert", "update", "delete", "upsert"])

function makeMigrationClient(client: SupabaseClient): SupabaseClient {
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
                  `MIGRATION GUARD: .${m}() on table '${table}' not permitted. ` +
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
          "MIGRATION GUARD: .rpc() blocked. " +
            "Migration writes go through the candidate_targeting table API only.",
        )
      }
      return Reflect.get(target, prop)
    },
  })
}

const rawSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const supabase = makeMigrationClient(rawSupabase)

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

// Audit counters
let readCount = 0
let writeCount = 0
function trackRead(label: string): void {
  readCount++
  console.log(`  [read #${readCount}] ${label}`)
}

// ============================================================================
// Anonymization (same as runner; duplicated for self-contained migration)
// ============================================================================

const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const PHONE_RX =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g
const URL_RX = /https?:\/\/\S+/g

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function anonymize(text: string, name: string | null): string {
  if (!text) return ""
  let out = text
  out = out.replace(EMAIL_RX, "[EMAIL]")
  out = out.replace(URL_RX, "[URL]")
  out = out.replace(PHONE_RX, "[PHONE]")
  if (name && name.trim().length >= 2) {
    const escaped = escapeRegex(name.trim())
    const nameRx = new RegExp(`\\b${escaped}\\b`, "gi")
    out = out.replace(nameRx, "[NAME]")
  }
  return out
}

// ============================================================================
// Profile types
// ============================================================================

type ProdProfile = {
  id: string
  name: string | null
  target_roles: string | null
  resume_text: string | null
  profile_structured: Record<string, unknown> | null
}

type Inferred = {
  output: InferenceOutput
  jobFamily: string | null
  isMinSignal: boolean
  appliedGuards: string[]
}

type MigrationOutcome = {
  profileId: string
  status: "created" | "skipped_existing" | "skipped_error"
  lane?: string
  sublane?: string | null
  confidence?: string
  careerStage?: string
  appliedGuards: string[]
  error?: string
}

// ============================================================================
// Inference + post-inference guards
// ============================================================================

async function inferProfile(
  profile: ProdProfile,
  jobFamily: string | null,
): Promise<
  | { ok: true; result: Inferred }
  | { ok: false; error: string; rawResponse?: string }
> {
  const targetRolesRaw = (profile.target_roles ?? "").trim()
  const resumeTextRaw = (profile.resume_text ?? "").trim()
  const intakeMeta =
    (profile.profile_structured as { intakeMeta?: { currentStatus?: string } })
      ?.intakeMeta ?? {}
  const currentStatus = (intakeMeta.currentStatus ?? "").trim()

  const isMinSignal =
    targetRolesRaw.length === 0 &&
    resumeTextRaw.length < 50 &&
    jobFamily === null

  const inferenceInput: InferenceInput = {
    targetRoles: anonymize(targetRolesRaw, profile.name),
    currentStatus,
    jobFamily,
    resumeSnippet: anonymize(resumeTextRaw, profile.name).slice(0, 500),
  }

  let raw = ""
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(inferenceInput) }],
    })
    const block = resp.content.find((b) => b.type === "text")
    raw = block && block.type === "text" ? block.text : ""
  } catch (e) {
    return {
      ok: false,
      error: `llm: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  const parsed = parseInferenceOutput(raw)
  if (!parsed.ok) {
    return { ok: false, error: `parse: ${parsed.error}`, rawResponse: raw }
  }

  const guards: string[] = []
  const out: InferenceOutput = { ...parsed.output }

  // ── PreMed dual-write (DD-04) ────────────────────────────────────────────
  // If JobFamily=PreMed, force lane=healthcare regardless of LLM output. The
  // status_premed=true flag is applied at payload construction time.
  if (jobFamily === "PreMed" && out.lane !== "healthcare") {
    guards.push(`premed_lane_override (was ${out.lane})`)
    out.lane = "healthcare"
    // Sub-lane may not be valid for healthcare anymore — null it; the
    // null-sublane guard below will fill in a default if needed.
    out.sublane = null
    out.primary_other_description = null
  }

  // ── Null-sublane guard (DD-20) ───────────────────────────────────────────
  // Non-Other lane with null sublane → first sub-lane + downgrade confidence.
  if (out.lane !== "other" && out.sublane === null) {
    const lane = LANES.find((l) => l.id === out.lane)
    if (lane && lane.subLanes.length > 0) {
      out.sublane = lane.subLanes[0].id
      const prevConfidence = out.confidence
      out.confidence = "low"
      guards.push(
        `null_sublane_override (filled ${out.sublane}; conf ${prevConfidence} → low)`,
      )
    }
  }

  // ── Empty-Other description fallback ─────────────────────────────────────
  // DB CHECK rejects lane=other with empty/whitespace description. If the LLM
  // returned that combo, fill a faithful fallback rather than abort the row.
  if (out.lane === "other") {
    const desc = (out.primary_other_description ?? "").trim()
    if (!desc) {
      out.primary_other_description =
        "Unspecified targeting (auto-classified from minimal intake signal)"
      guards.push("empty_other_description_fallback")
    }
  }

  return {
    ok: true,
    result: {
      output: out,
      jobFamily,
      isMinSignal,
      appliedGuards: guards,
    },
  }
}

// ============================================================================
// Data fetching (READ-ONLY for source tables; mutation only on candidate_targeting)
// ============================================================================

async function fetchAllProfiles(): Promise<ProdProfile[]> {
  const { data, error } = await supabase
    .from("client_profiles")
    .select("id, name, target_roles, resume_text, profile_structured")
  trackRead("client_profiles (all rows)")
  if (error) throw new Error(`client_profiles select failed: ${error.message}`)
  return (data ?? []) as ProdProfile[]
}

async function fetchExistingTargetingProfileIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("candidate_targeting")
    .select("profile_id")
  trackRead("candidate_targeting (existing profile_ids)")
  if (error) throw new Error(`candidate_targeting select failed: ${error.message}`)
  return new Set((data ?? []).map((r: { profile_id: string }) => r.profile_id))
}

async function fetchLatestJobFamilyByProfile(
  profileIds: string[],
): Promise<Map<string, string | null>> {
  if (profileIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from("jobfit_runs")
    .select("client_profile_id, result_json, created_at")
    .neq("verdict", "error")
    .in("client_profile_id", profileIds)
    .order("created_at", { ascending: false })
  trackRead(`jobfit_runs for ${profileIds.length} profiles`)
  if (error) throw new Error(`jobfit_runs select failed: ${error.message}`)

  const latest = new Map<string, string | null>()
  for (const row of (data ?? []) as Array<{
    client_profile_id: string
    result_json: Record<string, unknown> | null
  }>) {
    if (latest.has(row.client_profile_id)) continue
    const sig = (row.result_json as { job_signals?: { jobFamily?: string } })
      ?.job_signals
    latest.set(row.client_profile_id, sig?.jobFamily ?? null)
  }
  return latest
}

// ============================================================================
// Per-profile migration
// ============================================================================

async function migrateOne(
  profile: ProdProfile,
  jobFamily: string | null,
): Promise<MigrationOutcome> {
  // Idempotency: skip if targeting already exists
  const { row: existing } = await getCandidateTargeting(supabase, profile.id)
  if (existing) {
    return {
      profileId: profile.id,
      status: "skipped_existing",
      appliedGuards: [],
    }
  }

  // Inference + post-inference guards
  const inferred = await inferProfile(profile, jobFamily)
  if (!inferred.ok) {
    return {
      profileId: profile.id,
      status: "skipped_error",
      appliedGuards: [],
      error: inferred.error,
    }
  }

  const { output, isMinSignal, appliedGuards } = inferred.result

  // Career stage derivation (deterministic)
  const profileStructured = (profile.profile_structured ?? {}) as {
    intakeMeta?: { currentStatus?: string | null }
    yearsExperienceApprox?: number | null
  }
  const careerStage = deriveCareerStage({
    currentStatus: profileStructured.intakeMeta?.currentStatus ?? null,
    yearsExperienceApprox: profileStructured.yearsExperienceApprox ?? null,
  })

  // PreMed status_premed dual-write
  const statusPremed = jobFamily === "PreMed"
  if (statusPremed && !appliedGuards.some((g) => g.startsWith("premed_"))) {
    appliedGuards.push("premed_status_flag")
  }

  // Build payload
  const payload: CandidateTargetingPayload = {
    profile_id: profile.id,
    primary_lane: output.lane,
    primary_sublane: output.lane === "other" ? null : output.sublane,
    primary_other_description:
      output.lane === "other" ? output.primary_other_description : null,
    secondary_lane_1: null,
    secondary_sublane_1: null,
    secondary_lane_2: null,
    secondary_sublane_2: null,
    career_stage: careerStage,
    career_stage_locked_by: "inferred",
    status_premed: statusPremed,
    status_prelaw: false,
    status_pregrad: false,
    source: "migration",
  }

  // Write
  const result = await upsertCandidateTargeting(supabase, payload)
  if (result.error || !result.row) {
    return {
      profileId: profile.id,
      status: "skipped_error",
      appliedGuards,
      error: result.error ?? "upsert returned no row",
    }
  }

  writeCount++

  // Min-signal flag is informational; recorded in transcript via appliedGuards
  if (isMinSignal) appliedGuards.push("min_signal_input")

  return {
    profileId: profile.id,
    status: "created",
    lane: output.lane,
    sublane: payload.primary_sublane,
    confidence: output.confidence,
    careerStage,
    appliedGuards,
  }
}

// ============================================================================
// Output formatting
// ============================================================================

function formatOutcomeBlock(o: MigrationOutcome): string {
  const lines: string[] = []
  lines.push(`── ${o.profileId} ──`)
  lines.push(`  status:     ${o.status}`)
  if (o.status === "created") {
    lines.push(`  lane:       ${o.lane}`)
    lines.push(`  sublane:    ${o.sublane ?? "(null)"}`)
    lines.push(`  confidence: ${o.confidence}`)
    lines.push(`  career:     ${o.careerStage}`)
    if (o.appliedGuards.length > 0) {
      lines.push(`  guards:     ${o.appliedGuards.join(", ")}`)
    }
  } else if (o.status === "skipped_error") {
    lines.push(`  error:      ${o.error}`)
  }
  return lines.join("\n")
}

function formatSummary(outcomes: MigrationOutcome[]): string {
  const created = outcomes.filter((o) => o.status === "created")
  const skipped = outcomes.filter((o) => o.status === "skipped_existing")
  const errored = outcomes.filter((o) => o.status === "skipped_error")

  const guardCounts = new Map<string, number>()
  for (const o of created) {
    for (const g of o.appliedGuards) {
      const key = g.split(" ")[0] // strip parenthetical detail for counting
      guardCounts.set(key, (guardCounts.get(key) ?? 0) + 1)
    }
  }

  const laneCounts = new Map<string, number>()
  for (const o of created) {
    laneCounts.set(o.lane!, (laneCounts.get(o.lane!) ?? 0) + 1)
  }

  const confCounts = { high: 0, medium: 0, low: 0 }
  for (const o of created) {
    if (o.confidence === "high") confCounts.high++
    else if (o.confidence === "medium") confCounts.medium++
    else if (o.confidence === "low") confCounts.low++
  }

  const lines: string[] = []
  lines.push("")
  lines.push("=== MIGRATION SUMMARY ===")
  lines.push(`Profiles in source:       ${outcomes.length}`)
  lines.push(`  Created:                ${created.length}`)
  lines.push(`  Skipped (existing):     ${skipped.length}`)
  lines.push(`  Errored:                ${errored.length}`)
  lines.push("")
  if (created.length > 0) {
    lines.push("Confidence (of created):")
    lines.push(`  high:   ${confCounts.high}`)
    lines.push(`  medium: ${confCounts.medium}`)
    lines.push(`  low:    ${confCounts.low}`)
    lines.push("")
    lines.push("Lane distribution (of created):")
    const sorted = [...laneCounts.entries()].sort((a, b) => b[1] - a[1])
    for (const [lane, n] of sorted) lines.push(`  ${lane.padEnd(22)} ${n}`)
    lines.push("")
    if (guardCounts.size > 0) {
      lines.push("Applied guards (counts):")
      const gSorted = [...guardCounts.entries()].sort((a, b) => b[1] - a[1])
      for (const [g, n] of gSorted) lines.push(`  ${g.padEnd(34)} ${n}`)
    } else {
      lines.push("Applied guards: none")
    }
  }
  if (errored.length > 0) {
    lines.push("")
    lines.push("Errors:")
    for (const o of errored) lines.push(`  ${o.profileId}: ${o.error}`)
  }
  return lines.join("\n")
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const startedAt = new Date().toISOString()
  console.log("============================================================")
  console.log("CANDIDATE_TARGETING MIGRATION")
  console.log("============================================================")
  console.log(`Env file:       ${ENV_PATH}`)
  console.log(`Project URL:    ${SUPABASE_URL}`)
  console.log(`Environment:    ${IS_PROD ? "PROD" : "DEV"}`)
  console.log(`Model:          ${MODEL}`)
  console.log(`Started:        ${startedAt}`)
  console.log(`Write target:   candidate_targeting (ONLY — Proxy enforced)`)
  if (IS_PROD) console.log(`Confirm flag:   MIGRATION_CONFIRM_PROD=1`)
  console.log("")

  // Fetch source data
  console.log("Fetching profiles…")
  const profiles = await fetchAllProfiles()
  console.log(`  Got ${profiles.length} profiles`)

  console.log("Fetching existing candidate_targeting rows (idempotency check)…")
  const existing = await fetchExistingTargetingProfileIds()
  console.log(`  ${existing.size} profiles already have a targeting row`)

  const toMigrate = profiles.filter((p) => !existing.has(p.id))
  console.log(`  ${toMigrate.length} profiles need migration`)

  console.log("Fetching latest JobFit job_family per to-migrate profile…")
  const jobFamilyByProfile = await fetchLatestJobFamilyByProfile(
    toMigrate.map((p) => p.id),
  )
  console.log(`  Got JobFamily for ${jobFamilyByProfile.size} profiles`)
  console.log("")

  // Migrate
  console.log("Migrating (sequential, single-shot inference per profile)…")
  const outcomes: MigrationOutcome[] = []
  for (let i = 0; i < toMigrate.length; i++) {
    const p = toMigrate[i]
    const jf = jobFamilyByProfile.get(p.id) ?? null
    process.stdout.write(
      `  [${i + 1}/${toMigrate.length}] ${p.id.slice(0, 8)}… `,
    )
    const result = await migrateOne(p, jf)
    outcomes.push(result)
    if (result.status === "created") {
      process.stdout.write(
        `created (${result.lane}/${result.sublane ?? "—"}, ${result.confidence}, ${result.careerStage})\n`,
      )
    } else if (result.status === "skipped_existing") {
      process.stdout.write(`skipped (existing)\n`)
    } else {
      process.stdout.write(`ERROR ${result.error}\n`)
    }
  }

  // Add skipped-existing outcomes from profiles we filtered out
  for (const id of existing) {
    if (!outcomes.some((o) => o.profileId === id)) {
      outcomes.push({
        profileId: id,
        status: "skipped_existing",
        appliedGuards: [],
      })
    }
  }

  // Summary + transcript
  const summary = formatSummary(outcomes)

  const resultsDir = join(
    "scripts",
    "migrate-candidate-targeting",
    "results",
  )
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const envSlug = IS_PROD ? "prod" : "dev"
  const outPath = join(resultsDir, `migration-${envSlug}-${ts}.txt`)

  const lines: string[] = []
  lines.push("============================================================")
  lines.push("CANDIDATE_TARGETING MIGRATION — transcript")
  lines.push("============================================================")
  lines.push(`Env file:      ${ENV_PATH}`)
  lines.push(`Project URL:   ${SUPABASE_URL}`)
  lines.push(`Environment:   ${IS_PROD ? "PROD" : "DEV"}`)
  lines.push(`Model:         ${MODEL}`)
  lines.push(`Started:       ${startedAt}`)
  lines.push(`Finished:      ${new Date().toISOString()}`)
  lines.push(`Read count:    ${readCount}`)
  lines.push(`Write count:   ${writeCount}`)
  lines.push(`Write target:  candidate_targeting (ONLY — Proxy enforced)`)
  lines.push("")
  lines.push("─── PER-PROFILE OUTCOMES ───")
  lines.push("")
  for (const o of outcomes) {
    lines.push(formatOutcomeBlock(o))
    lines.push("")
  }
  lines.push(summary)

  writeFileSync(outPath, lines.join("\n"), "utf8")
  console.log("")
  console.log(summary)
  console.log("")
  console.log(`Transcript: ${outPath}`)
  console.log("")
  console.log("============================================================")
  console.log("AUDIT — end of run")
  console.log("============================================================")
  console.log(`  Environment:        ${IS_PROD ? "PROD" : "DEV"}`)
  console.log(`  Reads issued:       ${readCount}`)
  console.log(`  Writes issued:      ${writeCount}`)
  console.log(`  Write target:       candidate_targeting (ONLY — enforced)`)
  console.log(`  Profiles processed: ${outcomes.length}`)
  console.log(
    `  Created / skipped / errored: ${outcomes.filter((o) => o.status === "created").length} / ${outcomes.filter((o) => o.status === "skipped_existing").length} / ${outcomes.filter((o) => o.status === "skipped_error").length}`,
  )
}

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : String(e))
  console.error(
    `Audit: reads = ${readCount}, writes = ${writeCount} (target: candidate_targeting only)`,
  )
  process.exit(1)
})
