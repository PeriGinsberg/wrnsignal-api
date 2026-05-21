// scripts/seed-erin-coaches-center/verify-copy.ts
//
// Run the post-write verification queries against dev Supabase for a given
// target coach. Read-only.
//
// v2 (multi-target):
//   - --target=<erin|peri> picks which coach's copies to verify
//   - Coach profile resolved by email (matches the seed script's TARGETS map)
//   - Row count assertions are no longer hard-coded to "5" — Q1 verifies the
//     target has ≥1 active+full links, prints them all. Q2 prints counts
//     without asserting specific numbers per name (the seed script's
//     --clients flag means the expected list varies per run).
//
// Run:
//   NODE_OPTIONS=--use-system-ca npx tsx scripts/seed-erin-coaches-center/verify-copy.ts --target=erin
//   NODE_OPTIONS=--use-system-ca npx tsx scripts/seed-erin-coaches-center/verify-copy.ts --target=peri

import { existsSync, readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

type Target = "erin" | "peri"

type TargetConfig = {
  emailPrefix: string
  coachEmail: string
}

const TARGETS: Record<Target, TargetConfig> = {
  erin: {
    emailPrefix: "erin+",
    coachEmail: "erin@workforcereadynow.com",
  },
  peri: {
    emailPrefix: "peri+",
    coachEmail: "peri+devcoach1@workforcereadynow.com",
  },
}

function getFlag(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find((a) => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : null
}

const TARGET_ARG = getFlag("target")
if (!TARGET_ARG) {
  console.error(
    "Missing required --target=<erin|peri>. Aborting.\n" +
      "Example: npx tsx scripts/seed-erin-coaches-center/verify-copy.ts --target=peri",
  )
  process.exit(1)
}
if (!(TARGET_ARG === "erin" || TARGET_ARG === "peri")) {
  console.error(`Invalid --target=${TARGET_ARG}. Allowed: erin, peri. Aborting.`)
  process.exit(1)
}
const TARGET: Target = TARGET_ARG
const TARGET_CONFIG = TARGETS[TARGET]

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

const envDev = loadEnv(".env.development.local")
const dev = createClient(envDev.SUPABASE_URL, envDev.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let allPass = true
const report: string[] = []

function pass(label: string, note: string) {
  report.push(`✓ Q${label}: ${note}`)
  console.log(`✓ Q${label}: ${note}`)
}
function fail(label: string, note: string) {
  allPass = false
  report.push(`✗ Q${label}: ${note}`)
  console.error(`✗ Q${label}: ${note}`)
}

let coachProfileId: string = ""

async function resolveCoachProfileId(): Promise<void> {
  const { data, error } = await dev
    .from("client_profiles")
    .select("id, is_coach, email")
    .eq("email", TARGET_CONFIG.coachEmail)
    .maybeSingle()
  if (error) {
    fail("0", `coach lookup failed: ${error.message}`)
    return
  }
  if (!data) {
    fail("0", `coach not found on dev (email=${TARGET_CONFIG.coachEmail})`)
    return
  }
  if (!data.is_coach) {
    fail("0", `coach profile exists but is_coach=false (email=${TARGET_CONFIG.coachEmail})`)
    return
  }
  coachProfileId = data.id as string
  pass("0", `target coach resolved: ${TARGET_CONFIG.coachEmail} → ${coachProfileId}`)
}

async function q1() {
  // All copies linked to the target coach via coach_clients.
  const { data: links, error: lErr } = await dev
    .from("coach_clients")
    .select("status, access_level, invited_at, client_profile_id")
    .eq("coach_profile_id", coachProfileId)
    .order("invited_at", { ascending: true })
  if (lErr) {
    fail("1", `links query error: ${lErr.message}`)
    return
  }
  const linkRows = (links ?? []) as Array<{
    status: string
    access_level: string
    invited_at: string
    client_profile_id: string
  }>
  const clientIds = linkRows.map((r) => r.client_profile_id)
  const { data: profiles, error: pErr } = await dev
    .from("client_profiles")
    .select("id, name, email, copied_from_prod_id")
    .in("id", clientIds.length ? clientIds : ["00000000-0000-0000-0000-000000000000"])
  if (pErr) {
    fail("1", `profile query error: ${pErr.message}`)
    return
  }
  const profileById = new Map(
    (profiles ?? []).map((p) => [p.id as string, p as Record<string, unknown>]),
  )

  console.log(`\nQ1 results (target=${TARGET}, coach=${coachProfileId}):`)
  for (const r of linkRows) {
    const cp = profileById.get(r.client_profile_id) ?? {}
    console.log(
      `  ${cp.name ?? "(no profile)"} | ${cp.email ?? "?"} | from=${cp.copied_from_prod_id ?? "?"} | status=${r.status} | access=${r.access_level}`,
    )
  }
  if (linkRows.length === 0) {
    fail("1", `no coach_clients rows for target=${TARGET}`)
    return
  }
  const wrongStatus = linkRows.filter((r) => r.status !== "active")
  const wrongAccess = linkRows.filter((r) => r.access_level !== "full")
  if (wrongStatus.length > 0) {
    fail("1", `${wrongStatus.length} rows have status != 'active'`)
    return
  }
  if (wrongAccess.length > 0) {
    fail("1", `${wrongAccess.length} rows have access_level != 'full'`)
    return
  }
  pass("1", `${linkRows.length} rows, all status='active', access_level='full'`)
}

async function q2() {
  // Per-client data sanity (this target's rows only)
  const likePrefix = TARGET_CONFIG.emailPrefix.replace(/[%_]/g, "\\$&")
  const { data: profiles, error: pErr } = await dev
    .from("client_profiles")
    .select("id, name, email")
    .like("email", `${likePrefix}%@workforcereadynow.com`)
    .not("copied_from_prod_id", "is", null)
    .order("name", { ascending: true })
  if (pErr) {
    fail("2", `profile query error: ${pErr.message}`)
    return
  }
  if (!profiles || profiles.length === 0) {
    fail("2", `no copied profiles found for target=${TARGET}`)
    return
  }

  console.log(`\nQ2 results (target=${TARGET}, ${profiles.length} profile(s)):`)
  for (const p of profiles) {
    const [{ count: personas }, { count: apps }, { count: jobfits }] =
      await Promise.all([
        dev
          .from("client_personas")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", p.id),
        dev
          .from("signal_applications")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", p.id),
        dev
          .from("jobfit_runs")
          .select("id", { count: "exact", head: true })
          .eq("client_profile_id", p.id),
      ])
    console.log(
      `  ${(p.name ?? "(no name)").padEnd(20)} | ${p.email} | personas=${personas} apps=${apps} jobfits=${jobfits}`,
    )
  }
  // v1 hard-coded a per-name Ryan check ("Ryan should show 0/0/0"). v2
  // drops that since the --clients flag means the expected list varies.
  // Just confirm we have profiles + their counts printed for human review.
  pass("2", `${profiles.length} profiles printed, counts shown for human review`)
}

async function q3() {
  // Orphan FK check on signal_applications.jobfit_run_id (global)
  const { data: apps, error: aErr } = await dev
    .from("signal_applications")
    .select("id, jobfit_run_id")
    .not("jobfit_run_id", "is", null)
  if (aErr) {
    fail("3", `apps query error: ${aErr.message}`)
    return
  }
  const refs = (apps ?? []).map((a) => a.jobfit_run_id as string)
  if (refs.length === 0) {
    pass("3", "0 orphan refs (no non-null jobfit_run_id values to check)")
    return
  }
  const { data: runs, error: rErr } = await dev
    .from("jobfit_runs")
    .select("id")
    .in("id", refs)
  if (rErr) {
    fail("3", `runs query error: ${rErr.message}`)
    return
  }
  const runIds = new Set((runs ?? []).map((r) => r.id as string))
  const orphans = refs.filter((id) => !runIds.has(id))
  console.log(`\nQ3: ${refs.length} non-null jobfit_run_id refs, ${orphans.length} orphan(s)`)
  if (orphans.length !== 0) {
    fail("3", `${orphans.length} orphan refs: ${orphans.join(", ")}`)
    return
  }
  pass("3", "0 orphan FKs")
}

async function q4() {
  // All dev auth users for this target exist and email-confirmed
  const likePrefix = TARGET_CONFIG.emailPrefix.replace(/[%_]/g, "\\$&")
  const { data: profiles, error: pErr } = await dev
    .from("client_profiles")
    .select("email, user_id")
    .like("email", `${likePrefix}%@workforcereadynow.com`)
    .not("copied_from_prod_id", "is", null)
  if (pErr) {
    fail("4", `profile query error: ${pErr.message}`)
    return
  }
  if (!profiles || profiles.length === 0) {
    fail("4", `no copied profiles found for target=${TARGET}`)
    return
  }

  // Fetch auth users; admin.listUsers is paginated
  const allUsers: Array<{ id: string; email?: string; email_confirmed_at?: string | null }> = []
  let page = 1
  while (true) {
    const { data, error } = await dev.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) {
      fail("4", `listUsers error: ${error.message}`)
      return
    }
    for (const u of data.users) {
      allUsers.push({
        id: u.id,
        email: u.email ?? undefined,
        email_confirmed_at: u.email_confirmed_at ?? null,
      })
    }
    if (data.users.length < 1000) break
    page++
    if (page > 50) break
  }
  const byId = new Map(allUsers.map((u) => [u.id, u]))

  console.log(`\nQ4 results (target=${TARGET}):`)
  let allConfirmed = true
  for (const p of profiles) {
    const u = byId.get(p.user_id as string)
    const confirmed = !!u?.email_confirmed_at
    console.log(
      `  ${p.email} | auth_email=${u?.email ?? "(missing)"} | confirmed=${confirmed}`,
    )
    if (!u || !confirmed) allConfirmed = false
  }
  if (!allConfirmed) {
    fail("4", "at least one auth user missing or not confirmed")
    return
  }
  pass("4", `${profiles.length} rows, all confirmed=true`)
}

async function main() {
  console.log("============================================================")
  console.log(`POST-WRITE VERIFICATION — dev (target=${TARGET})`)
  console.log("============================================================")
  console.log(`Dev URL: ${envDev.SUPABASE_URL}`)
  console.log(`Coach:   ${TARGET_CONFIG.coachEmail}`)
  console.log("")

  await resolveCoachProfileId()
  if (!coachProfileId) {
    console.log("Cannot continue without resolved coach profile id.")
    process.exit(1)
  }

  await q1()
  await q2()
  await q3()
  await q4()

  console.log("")
  console.log("============================================================")
  console.log(allPass ? "ALL VERIFICATIONS PASSED ✓" : "VERIFICATION FAILED ✗")
  console.log("============================================================")
  for (const line of report) console.log(`  ${line}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : String(e))
  process.exit(1)
})
