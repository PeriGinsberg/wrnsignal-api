// scripts/seed-erin-coaches-center/copy-prod-clients-to-dev.ts
//
// Copy hand-picked real prod clients into dev Supabase, create plus-addressed
// auth users for each, and link them all to a target coach account so the
// coach can sign in OR as any individual copied client.
//
// READS from prod (ejhnokcnahauvrcbcmic) — never writes.
// WRITES to dev (zydrqckpwidipwbhrfgd) — auth users + per-table copies.
//
// v1 (single target = Erin):
//   - Hard-coded SOURCE_PROD_PROFILE_IDS (5 clients)
//   - Hard-coded ERIN_DEV_COACH_PROFILE_ID
//   - Hard-coded "erin+" email prefix
//
// v2 (multi-target, this refactor):
//   - --target=<erin|peri> picks which coach gets the clients
//   - --clients=<comma-uuids> selects which prod clients to copy
//   - Email prefix + coach lookup driven by TARGETS config below
//   - Idempotency now keyed on (target_email, copied_from_prod_id)
//     instead of copied_from_prod_id alone — verified that dev.
//     client_profiles.copied_from_prod_id has NO unique constraint
//     (probe in scripts/probe-copied-from-prod-id-constraint.mjs ran
//     2026-05-21), so the same prod UUID can be copied per-target.
//
// Run:
//   DRY RUN (default — no writes):
//     npx tsx scripts/seed-erin-coaches-center/copy-prod-clients-to-dev.ts \
//       --target=erin --clients=<uuid>,<uuid>,...
//   REAL RUN (writes):
//     npx tsx scripts/seed-erin-coaches-center/copy-prod-clients-to-dev.ts \
//       --target=erin --clients=<uuid>,<uuid>,... --confirm
//
// Pattern reference: scripts/migrate-candidate-targeting/run-realdata-sample.ts
// (DD-16, DD-21). Schema discovery follows DD-27 — column lists are read from
// runtime sample rows, not hard-coded.
//
// ─── Rollback (run in dev Supabase SQL Editor if you need to undo) ─────────
//   -- 1. Delete dev auth users for copied clients (one target)
//   DELETE FROM auth.users
//   WHERE id IN (
//     SELECT user_id FROM client_profiles
//     WHERE email LIKE 'erin+%@workforcereadynow.com'   -- or 'peri+%'
//   );
//   -- 2. Delete copied client_profiles (coach_clients, signal_applications,
//   --    jobfit_runs, status_history, client_personas, candidate_targeting
//   --    cascade via FKs)
//   DELETE FROM client_profiles
//   WHERE email LIKE 'erin+%@workforcereadynow.com';     -- or 'peri+%'
// ────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

// ============================================================================
// Target registry
// ============================================================================
//
// Each target is a coach who can be a destination for this seed script.
// Adding a new target = adding an entry here + an email prefix convention.
// The coach's dev profile is resolved by email lookup at preflight time
// (avoids drift if profile_ids change). Erin's hard-coded id is kept as
// an assertion fallback for v1 compatibility — if the email lookup
// resolves to a different id, we abort.

type Target = "erin" | "peri"

type TargetConfig = {
  /** Email prefix for copied clients, e.g. "erin+catherine@..." */
  emailPrefix: string
  /** Coach's email on dev — used to resolve coach_profile_id at preflight. */
  coachEmail: string
  /** v1 hard-coded coach profile id — asserted against the lookup if set. */
  expectedCoachProfileId?: string
}

const TARGETS: Record<Target, TargetConfig> = {
  erin: {
    emailPrefix: "erin+",
    coachEmail: "erin@workforcereadynow.com",
    expectedCoachProfileId: "81062c92-2dff-4cc5-a685-9155b780e9f8",
  },
  peri: {
    emailPrefix: "peri+",
    coachEmail: "peri+devcoach1@workforcereadynow.com",
  },
}

const EMAIL_LABEL_OVERRIDES: Record<string, string> = {
  // Empty by default. Populate only if first-name collisions surface.
}

const NAME_OVERRIDES: Record<string, string> = {
  // Ryan's prod name is null; set him to 'Ryan Rosen' on the dev copy
  "8cbacf46-baf2-4f73-80a5-2c513d8f7ddf": "Ryan Rosen",
}

const APPS_LIMIT = 10
const JOBFITS_LIMIT = 5

// Columns we set explicitly on client_profiles regardless of what prod has.
// Schema-discovery sweeps any *other* columns and copies them raw from prod.
const EXPLICIT_CLIENT_PROFILE_COLUMNS = new Set([
  "id",
  "user_id",
  "email",
  "name",
  "coach_notes_avoid",
  "coach_notes_strengths",
  "coach_notes_concerns",
  "is_coach",
  "coach_org",
  "copied_from_prod_id",
  "active",
  "created_at",
  "updated_at",
])

// ============================================================================
// CLI args + env
// ============================================================================

const CONFIRM_FLAG = process.argv.includes("--confirm")

/** Pluck a `--name=value` style flag from process.argv. */
function getFlag(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find((a) => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : null
}

const TARGET_ARG = getFlag("target")
const CLIENTS_ARG = getFlag("clients")

if (!TARGET_ARG) {
  console.error(
    "Missing required --target=<erin|peri>. Aborting.\n" +
      "Example:\n" +
      "  npx tsx scripts/seed-erin-coaches-center/copy-prod-clients-to-dev.ts \\\n" +
      "    --target=peri \\\n" +
      "    --clients=<uuid>,<uuid>,...",
  )
  process.exit(1)
}
if (!(TARGET_ARG === "erin" || TARGET_ARG === "peri")) {
  console.error(
    `Invalid --target=${TARGET_ARG}. Allowed: erin, peri. Aborting.`,
  )
  process.exit(1)
}
const TARGET: Target = TARGET_ARG
const TARGET_CONFIG = TARGETS[TARGET]

if (!CLIENTS_ARG) {
  console.error(
    "Missing required --clients=<comma-uuids>. Aborting.\n" +
      "Example: --clients=3a2ef935-ff15-4bd7-b0f7-f8ee1bbafccf,2a9373f4-b120-42c3-9c54-1b31c8b9a7b8",
  )
  process.exit(1)
}
const SOURCE_PROD_PROFILE_IDS = CLIENTS_ARG.split(",")
  .map((s) => s.trim())
  .filter(Boolean)

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
for (const id of SOURCE_PROD_PROFILE_IDS) {
  if (!UUID_RX.test(id)) {
    console.error(`Invalid UUID in --clients: '${id}'. Aborting.`)
    process.exit(1)
  }
}
if (SOURCE_PROD_PROFILE_IDS.length === 0) {
  console.error("--clients parsed to empty list. Aborting.")
  process.exit(1)
}

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

const PROD_ENV_PATH = ".env.production.local"
const DEV_ENV_PATH = ".env.development.local"

if (!existsSync(PROD_ENV_PATH)) {
  console.error(`Missing ${PROD_ENV_PATH}. Aborting.`)
  process.exit(1)
}
if (!existsSync(DEV_ENV_PATH)) {
  console.error(`Missing ${DEV_ENV_PATH}. Aborting.`)
  process.exit(1)
}

const envProd = loadEnv(PROD_ENV_PATH)
const envDev = loadEnv(DEV_ENV_PATH)

const PROD_URL = envProd.SUPABASE_URL
const PROD_SRK = envProd.SUPABASE_SERVICE_ROLE_KEY
const DEV_URL = envDev.SUPABASE_URL
const DEV_SRK = envDev.SUPABASE_SERVICE_ROLE_KEY

if (!PROD_URL || !PROD_SRK) {
  console.error(
    `Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in ${PROD_ENV_PATH}.`,
  )
  process.exit(1)
}
if (!DEV_URL || !DEV_SRK) {
  console.error(
    `Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in ${DEV_ENV_PATH}.`,
  )
  process.exit(1)
}

// Sanity: the URLs must look like the expected projects.
const EXPECTED_PROD_HOST = "ejhnokcnahauvrcbcmic"
const EXPECTED_DEV_HOST = "zydrqckpwidipwbhrfgd"
if (!PROD_URL.includes(EXPECTED_PROD_HOST)) {
  console.error(
    `PROD url (${PROD_URL}) does not contain expected host ${EXPECTED_PROD_HOST}. Aborting.`,
  )
  process.exit(1)
}
if (!DEV_URL.includes(EXPECTED_DEV_HOST)) {
  console.error(
    `DEV url (${DEV_URL}) does not contain expected host ${EXPECTED_DEV_HOST}. Aborting.`,
  )
  process.exit(1)
}

// ============================================================================
// Supabase clients
// ============================================================================

const BLOCKED_PROD_MUTATIONS = new Set([
  "insert",
  "update",
  "delete",
  "upsert",
  "rpc",
])

function makeReadOnlyProd(client: SupabaseClient): SupabaseClient {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "from") {
        return (table: string) => {
          const builder = target.from(table)
          return new Proxy(builder, {
            get(b, m) {
              if (typeof m === "string" && BLOCKED_PROD_MUTATIONS.has(m)) {
                throw new Error(
                  `PROD-READ-ONLY: .${m}() blocked on '${table}'. Aborting.`,
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
          `PROD-READ-ONLY: .rpc() blocked. Aborting.`,
        )
      }
      if (prop === "auth") {
        // Block prod auth admin actions defensively.
        const a = (target as unknown as { auth: unknown }).auth
        return new Proxy(a as object, {
          get(at, p) {
            if (p === "admin") {
              throw new Error("PROD-READ-ONLY: .auth.admin blocked.")
            }
            return Reflect.get(at, p)
          },
        })
      }
      return Reflect.get(target, prop)
    },
  })
}

const prodRaw = createClient(PROD_URL, PROD_SRK, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const prod = makeReadOnlyProd(prodRaw)

const dev = createClient(DEV_URL, DEV_SRK, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ============================================================================
// Audit counters
// ============================================================================

const audit = {
  prodReads: 0,
  devReads: 0,
  devWrites: 0,
  devAuthCreates: 0,
}

function trackProdRead(label: string) {
  audit.prodReads++
  console.log(`  [prod read #${audit.prodReads}] ${label}`)
}

function trackDevRead(label: string) {
  audit.devReads++
  // Suppress per-line logging on dev reads (we issue many) — count only.
  void label
}

function trackDevWrite(label: string) {
  audit.devWrites++
  console.log(`  [dev write #${audit.devWrites}] ${label}`)
}

// ============================================================================
// Schema discovery (DD-27: no hard-coded column lists)
// ============================================================================
//
// Approach: SELECT one sample row from each table and use Object.keys to get
// the column list. For prod tables we know have rows for the source profiles,
// this always succeeds. For dev tables that may be empty, we fall back to the
// prod schema (assumes dev and prod mirror each other at the column level —
// which is true for the tables we touch). The fallback is logged.

type ColumnSet = Set<string>

async function discoverColumns(
  client: SupabaseClient,
  table: string,
  label: string,
): Promise<ColumnSet | null> {
  const { data, error } = await client.from(table).select("*").limit(1)
  if (error) {
    console.warn(`  schema-discovery WARN: ${label}.${table}: ${error.message}`)
    return null
  }
  if (!data || data.length === 0) return null
  return new Set(Object.keys(data[0] as Record<string, unknown>))
}

type Schemas = {
  client_profiles_dev: ColumnSet
  client_personas_prod: ColumnSet
  client_personas_dev: ColumnSet
  candidate_targeting_prod: ColumnSet
  candidate_targeting_dev: ColumnSet
  signal_applications_prod: ColumnSet
  signal_applications_dev: ColumnSet
  status_history_prod: ColumnSet
  status_history_dev: ColumnSet
  jobfit_runs_prod: ColumnSet
  jobfit_runs_dev: ColumnSet
  coach_clients_dev: ColumnSet
}

async function discoverAllSchemas(): Promise<Schemas> {
  console.log("Discovering table schemas (DD-27)…")

  const [
    cpDev,
    cpePr,
    cpeDv,
    ctPr,
    ctDv,
    saPr,
    saDv,
    shPr,
    shDv,
    jrPr,
    jrDv,
    ccDv,
  ] = await Promise.all([
    discoverColumns(dev, "client_profiles", "dev"),
    discoverColumns(prod, "client_personas", "prod"),
    discoverColumns(dev, "client_personas", "dev"),
    discoverColumns(prod, "candidate_targeting", "prod"),
    discoverColumns(dev, "candidate_targeting", "dev"),
    discoverColumns(prod, "signal_applications", "prod"),
    discoverColumns(dev, "signal_applications", "dev"),
    discoverColumns(prod, "signal_applications_status_history", "prod"),
    discoverColumns(dev, "signal_applications_status_history", "dev"),
    discoverColumns(prod, "jobfit_runs", "prod"),
    discoverColumns(dev, "jobfit_runs", "dev"),
    discoverColumns(dev, "coach_clients", "dev"),
  ])

  // Prod read counted once per table (not per limit-1 select line).
  audit.prodReads += 6

  if (!cpDev) throw new Error("Could not discover dev.client_profiles columns")
  if (!cpePr) throw new Error("Could not discover prod.client_personas columns")
  if (!ctPr) throw new Error("Could not discover prod.candidate_targeting columns")
  if (!saPr) throw new Error("Could not discover prod.signal_applications columns")
  if (!shPr) {
    console.warn(
      "  prod.signal_applications_status_history empty — falling back to a minimal column hint at insert time.",
    )
  }
  if (!jrPr) throw new Error("Could not discover prod.jobfit_runs columns")
  if (!ccDv) {
    console.warn(
      "  dev.coach_clients empty — schema will be inferred from prod parity at insert time.",
    )
  }

  return {
    client_profiles_dev: cpDev,
    client_personas_prod: cpePr,
    client_personas_dev: cpeDv ?? cpePr,
    candidate_targeting_prod: ctPr,
    candidate_targeting_dev: ctDv ?? ctPr,
    signal_applications_prod: saPr,
    signal_applications_dev: saDv ?? saPr,
    status_history_prod: shPr ?? new Set<string>(),
    status_history_dev: shDv ?? shPr ?? new Set<string>(),
    jobfit_runs_prod: jrPr,
    jobfit_runs_dev: jrDv ?? jrPr,
    coach_clients_dev: ccDv ?? new Set<string>(),
  }
}

// ============================================================================
// Step 0 — preflight checks + coach resolution
// ============================================================================
//
// Resolves TARGET_CONFIG.coachEmail to a coach profile id on dev. The
// resolved id is used by Step 5h's coach_clients insert. v1's hard-coded
// ERIN_DEV_COACH_PROFILE_ID is kept as an assertion fallback for the
// erin target only — if Erin's looked-up id differs from the expected
// value, abort (drift detection).

let RESOLVED_COACH_PROFILE_ID: string = ""

async function preflight(): Promise<void> {
  console.log("Preflight checks…")

  // 1. dev.client_profiles has copied_from_prod_id column
  const { data: cpProbe, error: cpErr } = await dev
    .from("client_profiles")
    .select("id, copied_from_prod_id")
    .limit(1)
  if (cpErr) {
    throw new Error(
      `dev.client_profiles.copied_from_prod_id check failed: ${cpErr.message}. ` +
        `Did the manual ALTER TABLE run on 2026-05-18?`,
    )
  }
  void cpProbe
  console.log("  ✓ dev.client_profiles.copied_from_prod_id present")

  // 2. Resolve coach profile id by email for the chosen target
  const { data: coach, error: coachErr } = await dev
    .from("client_profiles")
    .select("id, is_coach, name, email")
    .eq("email", TARGET_CONFIG.coachEmail)
    .maybeSingle()
  if (coachErr) {
    throw new Error(
      `Target coach lookup by email (${TARGET_CONFIG.coachEmail}) failed: ${coachErr.message}`,
    )
  }
  if (!coach) {
    throw new Error(
      `Target coach not found on dev for email=${TARGET_CONFIG.coachEmail}. ` +
        `Create the coach profile first, then re-run.`,
    )
  }
  if (!coach.is_coach) {
    throw new Error(
      `Target coach profile (${TARGET_CONFIG.coachEmail}) exists but is_coach=false. ` +
        `Set is_coach=true and re-run.`,
    )
  }
  if (
    TARGET_CONFIG.expectedCoachProfileId &&
    coach.id !== TARGET_CONFIG.expectedCoachProfileId
  ) {
    throw new Error(
      `Target=${TARGET}: looked-up coach profile id (${coach.id}) differs from ` +
        `expected (${TARGET_CONFIG.expectedCoachProfileId}). Drift detected — verify ` +
        `the TARGETS table before continuing.`,
    )
  }
  RESOLVED_COACH_PROFILE_ID = coach.id
  console.log(
    `  ✓ Target=${TARGET} coach profile present ` +
      `(name=${coach.name ?? "(null)"}, email=${coach.email ?? "(null)"}, id=${coach.id})`,
  )

  // 3 + 4 already covered by env file existence check at top of script.
  console.log(`  ✓ ${PROD_ENV_PATH} loaded`)
  console.log(`  ✓ ${DEV_ENV_PATH} loaded`)
}

// ============================================================================
// Helpers
// ============================================================================

function deriveEmailLabel(prodId: string, prodName: string | null): string {
  if (EMAIL_LABEL_OVERRIDES[prodId]) return EMAIL_LABEL_OVERRIDES[prodId]
  const sourceName = NAME_OVERRIDES[prodId] ?? prodName ?? ""
  const first = sourceName.trim().split(/\s+/)[0] ?? ""
  const label = first.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (!label) {
    throw new Error(
      `Cannot derive email label for prod_id=${prodId} (prod_name=${prodName ?? "null"}, no NAME_OVERRIDES entry).`,
    )
  }
  return label
}

async function findDevAuthUserByEmail(email: string): Promise<string | null> {
  // listUsers is paginated; we filter manually since there's no search-by-email.
  const perPage = 1000
  let page = 1
  while (true) {
    const { data, error } = await dev.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    const match = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    )
    if (match) return match.id
    if (data.users.length < perPage) return null
    page++
    if (page > 50) {
      throw new Error("listUsers exceeded 50 pages — bail out.")
    }
  }
}

// ============================================================================
// Per-profile copy
// ============================================================================

type ProfileResult = {
  prodId: string
  status: "skipped_existing" | "skipped_error" | "created" | "would_create"
  devId?: string
  devAuthUserId?: string
  prodName?: string | null
  devName?: string
  prodEmail?: string | null
  devEmail?: string
  personasCopied?: number
  personaDevIds?: string[]
  candidateTargetingCopied?: boolean
  applicationsCopied?: number
  applicationsTotal?: number
  jobfitRunsCopied?: number
  jobfitRunsTotal?: number
  statusHistoryCopied?: number
  coachClientId?: string
  error?: string
}

// Track rollback (compensating-delete) ops in case any step fails after we've
// already inserted rows for this profile.
type RollbackOp = { table: string; id: string }
function rollbackOps(): RollbackOp[] {
  return []
}

async function compensatingRollback(
  ops: RollbackOp[],
  authUserId: string | null,
): Promise<void> {
  console.log(`  [rollback] ${ops.length} row(s) to delete + auth user…`)
  for (const op of ops.reverse()) {
    const { error } = await dev.from(op.table).delete().eq("id", op.id)
    if (error) {
      console.error(
        `  [rollback ERROR] ${op.table} id=${op.id}: ${error.message}`,
      )
    }
  }
  if (authUserId) {
    const { error } = await dev.auth.admin.deleteUser(authUserId)
    if (error) {
      console.error(`  [rollback ERROR] auth user ${authUserId}: ${error.message}`)
    }
  }
}

function pickAllowedColumns(
  src: Record<string, unknown>,
  allowed: ColumnSet,
  excludeKeys: Set<string> = new Set(),
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(src)) {
    if (excludeKeys.has(k)) continue
    if (allowed.size > 0 && !allowed.has(k)) continue
    out[k] = src[k]
  }
  return out
}

async function copyOne(
  prodId: string,
  schemas: Schemas,
): Promise<ProfileResult> {
  const result: ProfileResult = { prodId, status: "skipped_error" }
  const ops = rollbackOps()
  let authUserIdForRollback: string | null = null

  try {
    // Step 1 — fetch prod profile FIRST so we can derive the per-target
    // email before doing the idempotency check (which now keys on email,
    // not copied_from_prod_id, so multiple targets can copy the same
    // prod UUID without colliding).
    const { data: srcProfile, error: srcErr } = await prod
      .from("client_profiles")
      .select("*")
      .eq("id", prodId)
      .maybeSingle()
    trackProdRead(`client_profiles id=${prodId}`)
    if (srcErr) throw new Error(`prod client_profiles fetch: ${srcErr.message}`)
    if (!srcProfile) throw new Error(`prod client_profiles id=${prodId} not found`)

    const srcRow = srcProfile as Record<string, unknown>
    const prodName = (srcRow.name as string | null) ?? null
    const prodEmail = (srcRow.email as string | null) ?? null
    const label = deriveEmailLabel(prodId, prodName)
    const targetEmail = `${TARGET_CONFIG.emailPrefix}${label}@workforcereadynow.com`
    const devName = NAME_OVERRIDES[prodId] ?? prodName ?? ""

    result.prodName = prodName
    result.prodEmail = prodEmail
    result.devEmail = targetEmail
    result.devName = devName

    // Step 2 — idempotency keyed on (target_email). Multi-target safe:
    //   - Same prod UUID copied for both erin + peri produces two rows
    //     with different emails (erin+catherine@ and peri+catherine@).
    //   - Re-running for the same target finds the existing email row
    //     and short-circuits as skipped.
    //   - Email collision with DIFFERENT copied_from_prod_id is treated
    //     as an error — manual intervention needed (probably a label
    //     collision; add EMAIL_LABEL_OVERRIDES entry).
    const { data: existing, error: existErr } = await dev
      .from("client_profiles")
      .select("id, copied_from_prod_id")
      .eq("email", targetEmail)
      .maybeSingle()
    trackDevRead(`idempotency check ${prodId} → ${targetEmail}`)
    if (existErr) {
      throw new Error(`idempotency check failed: ${existErr.message}`)
    }
    if (existing) {
      if (existing.copied_from_prod_id === prodId) {
        console.log(
          `  SKIP: ${prodId}: already copied as dev_id=${existing.id} (email=${targetEmail})`,
        )
        return {
          prodId,
          status: "skipped_existing",
          devId: existing.id,
          devEmail: targetEmail,
          prodName,
          devName,
          prodEmail,
        }
      }
      throw new Error(
        `Email collision: dev row exists at email=${targetEmail} but copied_from_prod_id=` +
          `${existing.copied_from_prod_id ?? "(null)"} (expected ${prodId}). ` +
          `Add EMAIL_LABEL_OVERRIDES['${prodId}'] = '<distinct-label>' and re-run.`,
      )
    }

    // Step 2 (cont.) — auth-user collision check (separate from profile
    // row; profile + auth user can drift in pathological cases)
    const existingAuthId = await findDevAuthUserByEmail(targetEmail)
    if (existingAuthId) {
      throw new Error(
        `Email collision on dev auth.users for ${targetEmail} (existing user_id=${existingAuthId}). ` +
          `Add EMAIL_LABEL_OVERRIDES['${prodId}'] = '<distinct-label>' and re-run.`,
      )
    }

    // Step 3 — create dev auth user
    let newAuthUserId: string
    if (CONFIRM_FLAG) {
      const createRes = await dev.auth.admin.createUser({
        email: targetEmail,
        email_confirm: true,
      })
      if (createRes.error || !createRes.data?.user) {
        throw new Error(
          `auth.admin.createUser: ${createRes.error?.message ?? "no user returned"}`,
        )
      }
      newAuthUserId = createRes.data.user.id
      audit.devAuthCreates++
      authUserIdForRollback = newAuthUserId
      console.log(`  [dev auth create] ${targetEmail} → ${newAuthUserId}`)
    } else {
      newAuthUserId = `WOULD-CREATE-${randomUUID()}`
      console.log(`  WOULD CREATE auth user: email=${targetEmail}`)
    }
    result.devAuthUserId = newAuthUserId

    // Step 4 — fetch source data (personas / targeting / runs / apps / history)
    //
    // We fetch everything up front so the manifest in dry-run mode can show
    // accurate counts, AND so the per-row copies in real mode are deterministic
    // (don't re-query mid-transaction).

    const { data: personasSrc, error: persErr } = await prod
      .from("client_personas")
      .select("*")
      .eq("profile_id", prodId)
    trackProdRead(`client_personas profile_id=${prodId}`)
    if (persErr) throw new Error(`prod client_personas: ${persErr.message}`)
    const prodPersonas = (personasSrc ?? []) as Array<Record<string, unknown>>

    const { data: tgtSrc, error: tgtErr } = await prod
      .from("candidate_targeting")
      .select("*")
      .eq("profile_id", prodId)
      .maybeSingle()
    trackProdRead(`candidate_targeting profile_id=${prodId}`)
    if (tgtErr && tgtErr.code !== "PGRST116") {
      throw new Error(`prod candidate_targeting: ${tgtErr.message}`)
    }
    const prodTargeting = (tgtSrc ?? null) as Record<string, unknown> | null

    const { data: appsSrc, error: appsErr } = await prod
      .from("signal_applications")
      .select("*")
      .eq("profile_id", prodId)
      .order("created_at", { ascending: false })
      .limit(APPS_LIMIT)
    trackProdRead(`signal_applications profile_id=${prodId}`)
    if (appsErr) throw new Error(`prod signal_applications: ${appsErr.message}`)
    const prodApps = (appsSrc ?? []) as Array<Record<string, unknown>>

    const { count: appsTotal, error: appsCountErr } = await prod
      .from("signal_applications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", prodId)
    trackProdRead(`signal_applications count profile_id=${prodId}`)
    if (appsCountErr) throw new Error(`prod apps count: ${appsCountErr.message}`)

    const { data: runsSrc, error: runsErr } = await prod
      .from("jobfit_runs")
      .select("*")
      .eq("client_profile_id", prodId)
      .order("created_at", { ascending: false })
      .limit(JOBFITS_LIMIT)
    trackProdRead(`jobfit_runs client_profile_id=${prodId}`)
    if (runsErr) throw new Error(`prod jobfit_runs: ${runsErr.message}`)
    const prodRuns = (runsSrc ?? []) as Array<Record<string, unknown>>

    const { count: runsTotal, error: runsCountErr } = await prod
      .from("jobfit_runs")
      .select("id", { count: "exact", head: true })
      .eq("client_profile_id", prodId)
    trackProdRead(`jobfit_runs count client_profile_id=${prodId}`)
    if (runsCountErr) throw new Error(`prod runs count: ${runsCountErr.message}`)

    // Status history — fetch per copied app id
    const prodAppIds = prodApps.map((a) => a.id as string)
    let prodStatusHistory: Array<Record<string, unknown>> = []
    if (prodAppIds.length > 0) {
      const { data: shSrc, error: shErr } = await prod
        .from("signal_applications_status_history")
        .select("*")
        .in("application_id", prodAppIds)
        .order("changed_at", { ascending: true })
      trackProdRead(`status_history for ${prodAppIds.length} apps`)
      if (shErr) throw new Error(`prod status_history: ${shErr.message}`)
      prodStatusHistory = (shSrc ?? []) as Array<Record<string, unknown>>
    }

    // Step 4 (cont.) — build prod->dev UUID maps
    const newProfileId = randomUUID()
    const personaMap = new Map<string, string>()
    for (const p of prodPersonas) personaMap.set(p.id as string, randomUUID())
    const appMap = new Map<string, string>()
    for (const a of prodApps) appMap.set(a.id as string, randomUUID())
    const runMap = new Map<string, string>()
    for (const r of prodRuns) runMap.set(r.id as string, randomUUID())

    result.devId = newProfileId
    result.applicationsCopied = prodApps.length
    result.applicationsTotal = appsTotal ?? prodApps.length
    result.jobfitRunsCopied = prodRuns.length
    result.jobfitRunsTotal = runsTotal ?? prodRuns.length
    result.personasCopied = prodPersonas.length
    result.personaDevIds = prodPersonas.map((p) => personaMap.get(p.id as string)!)
    result.candidateTargetingCopied = !!prodTargeting
    result.statusHistoryCopied = prodStatusHistory.length

    // ── Step 5a: client_profiles ─────────────────────────────────────────────
    const nowIso = new Date().toISOString()
    const cpAllowed = schemas.client_profiles_dev
    const cpBase = pickAllowedColumns(srcRow, cpAllowed, EXPLICIT_CLIENT_PROFILE_COLUMNS)
    const cpRow: Record<string, unknown> = {
      ...cpBase,
      id: newProfileId,
      user_id: newAuthUserId,
      email: targetEmail,
      name: devName,
      coach_notes_avoid: null,
      coach_notes_strengths: null,
      coach_notes_concerns: null,
      is_coach: false,
      coach_org: null,
      copied_from_prod_id: prodId,
      active: true,
      created_at: nowIso,
      updated_at: nowIso,
    }
    // profile_text is NOT NULL — guarantee it's present
    if (!cpRow.profile_text) {
      cpRow.profile_text = (srcRow.profile_text as string | null) ?? ""
    }
    await applyInsert("client_profiles", cpRow, ops)

    // ── Step 5b: client_personas ─────────────────────────────────────────────
    for (const p of prodPersonas) {
      const devPersonaId = personaMap.get(p.id as string)!
      const personaRow = pickAllowedColumns(
        p,
        schemas.client_personas_dev,
        new Set(["id", "profile_id"]),
      )
      personaRow.id = devPersonaId
      personaRow.profile_id = newProfileId
      await applyInsert("client_personas", personaRow, ops)
    }

    // ── Step 5c: candidate_targeting (0 or 1) ───────────────────────────────
    if (prodTargeting) {
      const ctRow = pickAllowedColumns(
        prodTargeting,
        schemas.candidate_targeting_dev,
        new Set(["id", "profile_id"]),
      )
      ctRow.id = randomUUID()
      ctRow.profile_id = newProfileId
      await applyInsert("candidate_targeting", ctRow, ops)
    }

    // ── Step 5d: jobfit_runs ────────────────────────────────────────────────
    for (const r of prodRuns) {
      const newRunId = runMap.get(r.id as string)!
      const runRow = pickAllowedColumns(
        r,
        schemas.jobfit_runs_dev,
        new Set([
          "id",
          "client_profile_id",
          "persona_id",
          "application_id",
          "sourced_by_coach_id",
        ]),
      )
      runRow.id = newRunId
      runRow.client_profile_id = newProfileId
      const srcPersonaId = (r.persona_id as string | null) ?? null
      runRow.persona_id = srcPersonaId ? (personaMap.get(srcPersonaId) ?? null) : null
      runRow.application_id = null // back-filled in step f
      runRow.sourced_by_coach_id = null
      await applyInsert("jobfit_runs", runRow, ops)
    }

    // ── Step 5e: signal_applications ────────────────────────────────────────
    for (const a of prodApps) {
      const newAppId = appMap.get(a.id as string)!
      const appRow = pickAllowedColumns(
        a,
        schemas.signal_applications_dev,
        new Set([
          "id",
          "profile_id",
          "persona_id",
          "jobfit_run_id",
          "positioning_run_id",
          "coverletter_run_id",
        ]),
      )
      appRow.id = newAppId
      appRow.profile_id = newProfileId
      const srcPersonaId = (a.persona_id as string | null) ?? null
      appRow.persona_id = srcPersonaId ? (personaMap.get(srcPersonaId) ?? null) : null
      const srcRunId = (a.jobfit_run_id as string | null) ?? null
      appRow.jobfit_run_id = srcRunId ? (runMap.get(srcRunId) ?? null) : null
      appRow.positioning_run_id = null
      appRow.coverletter_run_id = null
      await applyInsert("signal_applications", appRow, ops)
    }

    // ── Step 5f: back-fill jobfit_runs.application_id ───────────────────────
    for (const r of prodRuns) {
      const srcAppId = (r.application_id as string | null) ?? null
      if (!srcAppId) continue
      const newAppId = appMap.get(srcAppId)
      if (!newAppId) continue
      const newRunId = runMap.get(r.id as string)!
      if (CONFIRM_FLAG) {
        const { error } = await dev
          .from("jobfit_runs")
          .update({ application_id: newAppId })
          .eq("id", newRunId)
        if (error) {
          throw new Error(
            `back-fill jobfit_runs.application_id (${newRunId}): ${error.message}`,
          )
        }
        trackDevWrite(`UPDATE jobfit_runs id=${newRunId} application_id=${newAppId}`)
      } else {
        console.log(
          `  WOULD UPDATE jobfit_runs id=${newRunId} SET application_id=${newAppId}`,
        )
      }
    }

    // ── Step 5g: signal_applications_status_history ─────────────────────────
    for (const h of prodStatusHistory) {
      const srcAppId = h.application_id as string
      const newAppId = appMap.get(srcAppId)
      if (!newAppId) continue
      const newHistId = randomUUID()
      const shAllowed = schemas.status_history_dev
      // If we couldn't discover columns at all, copy raw minus the obvious keys.
      const histRow =
        shAllowed.size > 0
          ? pickAllowedColumns(
              h,
              shAllowed,
              new Set(["id", "application_id", "changed_by"]),
            )
          : ((): Record<string, unknown> => {
              const o: Record<string, unknown> = { ...h }
              delete o.id
              delete o.application_id
              delete o.changed_by
              return o
            })()
      histRow.id = newHistId
      histRow.application_id = newAppId
      histRow.changed_by = null
      await applyInsert("signal_applications_status_history", histRow, ops)
    }

    // ── Step 5h: coach_clients ──────────────────────────────────────────────
    const prodCreatedAt = (srcRow.created_at as string | null) ?? nowIso
    const acceptedAt = new Date(
      new Date(prodCreatedAt).getTime() + 60_000,
    ).toISOString()
    const coachClientId = randomUUID()
    const ccBase: Record<string, unknown> = {
      id: coachClientId,
      coach_profile_id: RESOLVED_COACH_PROFILE_ID,
      client_profile_id: newProfileId,
      status: "active",
      access_level: "full",
      invited_email: targetEmail,
      invite_token: randomUUID(),
      invited_at: prodCreatedAt,
      accepted_at: acceptedAt,
      last_viewed_at: null,
      private_notes: null,
    }
    // If schema discovery surfaced more columns, only emit ones the dev table
    // actually has. If the table was empty (size==0), we send the full base set
    // and trust the schema parity.
    const ccRow =
      schemas.coach_clients_dev.size > 0
        ? pickAllowedColumns(ccBase, schemas.coach_clients_dev)
        : ccBase
    await applyInsert("coach_clients", ccRow, ops)
    result.coachClientId = coachClientId

    result.status = CONFIRM_FLAG ? "created" : "would_create"
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`  ERROR copying ${prodId}: ${msg}`)
    result.error = msg
    if (CONFIRM_FLAG && ops.length > 0) {
      await compensatingRollback(ops, authUserIdForRollback)
    }
    return result
  }
}

async function applyInsert(
  table: string,
  row: Record<string, unknown>,
  ops: RollbackOp[],
): Promise<void> {
  if (CONFIRM_FLAG) {
    const { error } = await dev.from(table).insert(row)
    if (error) {
      throw new Error(`INSERT ${table}: ${error.message}`)
    }
    trackDevWrite(`INSERT ${table} id=${row.id}`)
    if (row.id) ops.push({ table, id: row.id as string })
  } else {
    const id = row.id as string | undefined
    console.log(`  WOULD INSERT ${table} id=${id ?? "(no id)"}: ${summarizeRow(row)}`)
  }
}

function summarizeRow(row: Record<string, unknown>): string {
  // Compact one-line summary that shows the most useful fields without
  // dumping huge JSON blobs (result_json, profile_text, etc).
  const compact: Record<string, unknown> = {}
  for (const k of Object.keys(row)) {
    const v = row[k]
    if (v === null || v === undefined) {
      compact[k] = v
      continue
    }
    if (typeof v === "string" && v.length > 80) {
      compact[k] = `<${v.length} chars>`
    } else if (typeof v === "object") {
      try {
        const s = JSON.stringify(v)
        compact[k] = s.length > 80 ? `<json ${s.length} chars>` : v
      } catch {
        compact[k] = "<unserializable>"
      }
    } else {
      compact[k] = v
    }
  }
  return JSON.stringify(compact)
}

// ============================================================================
// Manifest writing
// ============================================================================

function formatManifestBlock(r: ProfileResult): string {
  const lines: string[] = []
  lines.push("=== Profile copied ===")
  lines.push(`prod_id:                  ${r.prodId}`)
  lines.push(`dev_id:                   ${r.devId ?? "(none)"}`)
  lines.push(`dev_auth_user_id:         ${r.devAuthUserId ?? "(none)"}`)
  lines.push(`prod_name:                ${r.prodName ?? "(null)"}`)
  lines.push(`dev_name:                 ${r.devName ?? "(none)"}`)
  lines.push(`prod_email:               ${r.prodEmail ?? "(null)"}`)
  lines.push(`dev_email:                ${r.devEmail ?? "(none)"}`)
  lines.push(
    `personas copied:          ${r.personasCopied ?? 0}` +
      (r.personaDevIds && r.personaDevIds.length > 0
        ? ` (dev_uuids: [${r.personaDevIds.join(", ")}])`
        : ""),
  )
  lines.push(
    `candidate_targeting:      ${r.candidateTargetingCopied ? "yes" : "no"}`,
  )
  lines.push(
    `applications copied:      ${r.applicationsCopied ?? 0} of ${r.applicationsTotal ?? 0} total`,
  )
  lines.push(
    `jobfit_runs copied:       ${r.jobfitRunsCopied ?? 0} of ${r.jobfitRunsTotal ?? 0} total`,
  )
  lines.push(`status_history rows:      ${r.statusHistoryCopied ?? 0}`)
  lines.push(`coach_clients link:       ${r.coachClientId ?? "(none)"}`)
  lines.push(`status:                   ${r.status}`)
  if (r.error) lines.push(`error:                    ${r.error}`)
  lines.push("=====================")
  return lines.join("\n")
}

function formatTotalsBlock(results: ProfileResult[]): string {
  const skipped = results.filter((r) => r.status === "skipped_existing").length
  const failed = results.filter((r) => r.status === "skipped_error").length
  const ok = results.filter(
    (r) => r.status === "created" || r.status === "would_create",
  )
  const successful = ok.length

  const sum = (key: keyof ProfileResult) =>
    ok.reduce((acc, r) => acc + ((r[key] as number | undefined) ?? 0), 0)

  const lines: string[] = []
  lines.push("=== TOTALS ===")
  lines.push(`profiles requested:               ${results.length}`)
  lines.push(`profiles skipped (already copied): ${skipped}`)
  lines.push(`profiles failed:                  ${failed}`)
  lines.push(`profiles successful:              ${successful}`)
  lines.push(`dev auth users created:           ${audit.devAuthCreates}`)
  lines.push(`client_profiles inserted:         ${successful}`)
  lines.push(`client_personas inserted:         ${sum("personasCopied")}`)
  lines.push(
    `candidate_targeting inserted:     ${ok.filter((r) => r.candidateTargetingCopied).length}`,
  )
  lines.push(`signal_applications inserted:     ${sum("applicationsCopied")}`)
  lines.push(`jobfit_runs inserted:             ${sum("jobfitRunsCopied")}`)
  lines.push(`status_history inserted:          ${sum("statusHistoryCopied")}`)
  lines.push(`coach_clients inserted:           ${ok.filter((r) => r.coachClientId).length}`)
  lines.push("==============")
  return lines.join("\n")
}

function buildPostWriteVerifySql(
  coachProfileId: string,
  emailPrefix: string,
  expectedClientCount: number,
): string {
  // emailPrefix is "erin+" / "peri+" — escape for LIKE pattern.
  const likePrefix = emailPrefix.replace(/[%_]/g, "\\$&")
  return `-- 1. All copies linked to the target coach via coach_clients
SELECT cp.name, cp.email, cp.copied_from_prod_id,
       cc.status, cc.access_level, cc.invited_at
FROM client_profiles cp
JOIN coach_clients cc ON cc.client_profile_id = cp.id
WHERE cc.coach_profile_id = '${coachProfileId}'
ORDER BY cc.invited_at;
-- Expect: >= ${expectedClientCount} rows total for this target,
-- all status='active', all access_level='full'

-- 2. Per-client data sanity (this target's rows only)
SELECT cp.name, cp.email,
  (SELECT count(*) FROM client_personas WHERE profile_id = cp.id) personas,
  (SELECT count(*) FROM signal_applications WHERE profile_id = cp.id) apps,
  (SELECT count(*) FROM jobfit_runs WHERE client_profile_id = cp.id) jobfits
FROM client_profiles cp
WHERE cp.email LIKE '${likePrefix}%@workforcereadynow.com'
  AND cp.copied_from_prod_id IS NOT NULL
ORDER BY cp.name;
-- Expect: realistic counts per client

-- 3. No orphan FKs (global — applies across all targets)
SELECT count(*) FROM signal_applications sa
WHERE sa.jobfit_run_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM jobfit_runs WHERE id = sa.jobfit_run_id);
-- Expect: 0

-- 4. All dev auth users for this target exist and are email-confirmed
SELECT cp.email, u.email AS auth_email,
       u.email_confirmed_at IS NOT NULL AS confirmed
FROM client_profiles cp
JOIN auth.users u ON u.id = cp.user_id
WHERE cp.email LIKE '${likePrefix}%@workforcereadynow.com'
  AND cp.copied_from_prod_id IS NOT NULL;
-- Expect: >= ${expectedClientCount} rows for this target, all confirmed=true`
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const startedAt = new Date().toISOString()
  console.log("============================================================")
  console.log("SEED COACHES CENTER — copy prod clients to dev")
  console.log("============================================================")
  console.log(`Target:      ${TARGET} (coach=${TARGET_CONFIG.coachEmail}, prefix=${TARGET_CONFIG.emailPrefix})`)
  console.log(`Clients:     ${SOURCE_PROD_PROFILE_IDS.length} prod UUID(s)`)
  console.log(`Mode:        ${CONFIRM_FLAG ? "WRITE (--confirm)" : "DRY RUN (default)"}`)
  console.log(`Prod URL:    ${PROD_URL}`)
  console.log(`Dev URL:     ${DEV_URL}`)
  console.log(`Started:     ${startedAt}`)
  console.log("")

  await preflight()
  console.log("")
  const schemas = await discoverAllSchemas()
  console.log("  ✓ schemas discovered")
  console.log("")

  const results: ProfileResult[] = []
  for (let i = 0; i < SOURCE_PROD_PROFILE_IDS.length; i++) {
    const id = SOURCE_PROD_PROFILE_IDS[i]
    console.log(`[${i + 1}/${SOURCE_PROD_PROFILE_IDS.length}] ${id}`)
    const r = await copyOne(id, schemas)
    results.push(r)
    console.log("")
  }

  // Manifest write
  const resultsDir = join("scripts", "seed-erin-coaches-center", "results")
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const modeSlug = CONFIRM_FLAG ? "confirm" : "dryrun"
  const outPath = join(resultsDir, `copy-${TARGET}-${modeSlug}-${ts}.txt`)

  const blocks: string[] = []
  blocks.push("============================================================")
  blocks.push(`SEED COACHES CENTER — transcript (target=${TARGET})`)
  blocks.push("============================================================")
  blocks.push(`Target:       ${TARGET}`)
  blocks.push(`Coach email:  ${TARGET_CONFIG.coachEmail}`)
  blocks.push(`Coach id:     ${RESOLVED_COACH_PROFILE_ID}`)
  blocks.push(`Email prefix: ${TARGET_CONFIG.emailPrefix}`)
  blocks.push(`Clients:      ${SOURCE_PROD_PROFILE_IDS.length} prod UUID(s)`)
  blocks.push(`Mode:         ${CONFIRM_FLAG ? "WRITE" : "DRY RUN"}`)
  blocks.push(`Prod URL:     ${PROD_URL}`)
  blocks.push(`Dev URL:      ${DEV_URL}`)
  blocks.push(`Started:      ${startedAt}`)
  blocks.push(`Finished:     ${new Date().toISOString()}`)
  blocks.push(`Prod reads:   ${audit.prodReads}`)
  blocks.push(`Dev reads:    ${audit.devReads}`)
  blocks.push(`Dev writes:   ${audit.devWrites}`)
  blocks.push(`Auth creates: ${audit.devAuthCreates}`)
  blocks.push("")
  for (const r of results) {
    blocks.push(formatManifestBlock(r))
    blocks.push("")
  }
  blocks.push(formatTotalsBlock(results))
  blocks.push("")
  if (CONFIRM_FLAG) {
    blocks.push("─── POST-WRITE VERIFICATION SQL (run in dev SQL Editor) ───")
    blocks.push("")
    blocks.push(
      buildPostWriteVerifySql(
        RESOLVED_COACH_PROFILE_ID,
        TARGET_CONFIG.emailPrefix,
        SOURCE_PROD_PROFILE_IDS.length,
      ),
    )
  }

  writeFileSync(outPath, blocks.join("\n"), "utf8")

  console.log("")
  console.log(formatTotalsBlock(results))
  console.log("")
  console.log(`Transcript: ${outPath}`)
  console.log("")
  console.log("============================================================")
  console.log("AUDIT — end of run")
  console.log("============================================================")
  console.log(`  Mode:               ${CONFIRM_FLAG ? "WRITE" : "DRY RUN"}`)
  console.log(`  Prod reads:         ${audit.prodReads}`)
  console.log(`  Dev reads:          ${audit.devReads}`)
  console.log(`  Dev writes:         ${audit.devWrites}`)
  console.log(`  Dev auth creates:   ${audit.devAuthCreates}`)
  console.log(
    `  Profiles processed: ${results.length} (created=${results.filter((r) => r.status === "created" || r.status === "would_create").length}, skipped=${results.filter((r) => r.status === "skipped_existing").length}, errored=${results.filter((r) => r.status === "skipped_error").length})`,
  )
  if (CONFIRM_FLAG) {
    console.log("")
    console.log("Next: run the POST-WRITE VERIFICATION SQL block (saved to the")
    console.log("transcript) in the dev Supabase SQL Editor and confirm.")
  }
}

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : String(e))
  console.error(
    `Audit: prodReads=${audit.prodReads}, devReads=${audit.devReads}, devWrites=${audit.devWrites}, authCreates=${audit.devAuthCreates}`,
  )
  process.exit(1)
})
