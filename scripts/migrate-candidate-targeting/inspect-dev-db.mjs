// scripts/migrate-candidate-targeting/inspect-dev-db.mjs
//
// Read-only inspection. Pass env file path as first CLI arg.
//   Default:  .env.development.local
//   Prod use: node inspect-dev-db.mjs .env.production.local
//
// Answers:
//   1. How many client_profiles exist?
//   2. How many have usable profile_text (>100 chars)?
//   3. Email-pattern bucketing (counts only — no individual emails printed)
//   4. How many have JobFit runs? JobFamily distribution?
//   5. How many "min signal" profiles?
//
// NO writes. NO PII surfaced — no raw target_roles or emails printed.

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const ENV_PATH = process.argv[2] ?? ".env.development.local"

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf8")
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

console.log(`Project: ${env.SUPABASE_URL}`)
console.log(`Env file: ${ENV_PATH}\n`)

// ─── 1. Total profile counts ──────────────────────────────────────────────
const { count: totalProfiles } = await sb
  .from("client_profiles")
  .select("id", { count: "exact", head: true })

const { count: usableProfiles } = await sb
  .from("client_profiles")
  .select("id", { count: "exact", head: true })
  .not("profile_text", "is", null)
  .gte("profile_text_length", 1) // placeholder; real check below

// Better: pull a sample and filter in JS for length check
const { data: allProfilesSlim } = await sb
  .from("client_profiles")
  .select("id, email, name, target_roles, resume_text, profile_text")

const usableCount = (allProfilesSlim ?? []).filter(
  (p) => p.profile_text && p.profile_text.length > 100,
).length

console.log("=== Client profiles ===")
console.log(`  Total:                       ${totalProfiles ?? "?"}`)
console.log(`  With profile_text > 100 chrs: ${usableCount}`)

// ─── 2. Test-fixture heuristic via email pattern ──────────────────────────
const emailBuckets = {
  test_explicit: 0, // contains 'test' or '+test'
  example_dot_com: 0, // ends with @example.com / @example.org
  workforcereadynow: 0, // @workforcereadynow.com (Peri / Erin / staff)
  plus_addressed: 0, // contains '+' (gmail aliases)
  other: 0,
}
for (const p of allProfilesSlim ?? []) {
  const e = String(p.email ?? "").toLowerCase()
  if (!e) {
    emailBuckets.other++
  } else if (/test/.test(e)) {
    emailBuckets.test_explicit++
  } else if (/@example\.(com|org|net)$/.test(e)) {
    emailBuckets.example_dot_com++
  } else if (/@workforcereadynow\.com$/.test(e)) {
    emailBuckets.workforcereadynow++
  } else if (/\+/.test(e)) {
    emailBuckets.plus_addressed++
  } else {
    emailBuckets.other++
  }
}

console.log("\n=== Email pattern buckets (test-fixture heuristic) ===")
console.log(`  test_explicit ('test' in email):   ${emailBuckets.test_explicit}`)
console.log(`  example_dot_com (@example.*):      ${emailBuckets.example_dot_com}`)
console.log(`  workforcereadynow (staff):         ${emailBuckets.workforcereadynow}`)
console.log(`  plus_addressed (contains '+'):     ${emailBuckets.plus_addressed}`)
console.log(`  other (likely real users):         ${emailBuckets.other}`)

// ─── 3. JobFit runs and JobFamily distribution ────────────────────────────
const { count: jobfitRunCount } = await sb
  .from("jobfit_runs")
  .select("id", { count: "exact", head: true })

console.log(`\n=== JobFit runs ===`)
console.log(`  Total jobfit_runs: ${jobfitRunCount ?? "?"}`)

// Distribution: pull all jobfit_runs, extract result_json.job_signals.jobFamily
const { data: runs } = await sb
  .from("jobfit_runs")
  .select("client_profile_id, result_json, verdict, created_at")
  .neq("verdict", "error")

const familyCounts = new Map()
const profilesWithRun = new Set()
for (const r of runs ?? []) {
  profilesWithRun.add(r.client_profile_id)
  const jf =
    (r.result_json && (r.result_json.job_signals?.jobFamily ?? null)) || null
  familyCounts.set(jf, (familyCounts.get(jf) ?? 0) + 1)
}

console.log(`  Successful runs (verdict != 'error'): ${runs?.length ?? 0}`)
console.log(`  Distinct profiles with ≥1 successful run: ${profilesWithRun.size}`)
console.log(`  JobFamily distribution (across all successful runs):`)
const sortedFamilies = [...familyCounts.entries()].sort((a, b) => b[1] - a[1])
for (const [jf, n] of sortedFamilies) {
  console.log(`    ${String(jf ?? "(null)").padEnd(20)} ${n}`)
}

// ─── 4. Min-signal profile count ──────────────────────────────────────────
let minSignalCount = 0
for (const p of allProfilesSlim ?? []) {
  const hasTargetRoles = Boolean(p.target_roles && p.target_roles.trim())
  const hasResume = Boolean(p.resume_text && p.resume_text.trim().length > 50)
  const hasRun = profilesWithRun.has(p.id)
  if (!hasTargetRoles && !hasResume && !hasRun) minSignalCount++
}

console.log("\n=== Min-signal profiles ===")
console.log(`  (no target_roles AND no resume_text AND no JobFit run)`)
console.log(`  Count: ${minSignalCount} / ${allProfilesSlim?.length ?? 0}`)

// ─── 5. target_roles availability count (no content printed) ──────────────
const withTargetRolesCount = (allProfilesSlim ?? []).filter(
  (p) => p.target_roles && p.target_roles.trim().length > 0,
).length
const withResumeCount = (allProfilesSlim ?? []).filter(
  (p) => p.resume_text && p.resume_text.trim().length > 50,
).length

console.log("\n=== Signal availability ===")
console.log(`  Profiles with target_roles (any text):   ${withTargetRolesCount}`)
console.log(`  Profiles with resume_text > 50 chars:    ${withResumeCount}`)

console.log("\nDone (read-only).")
