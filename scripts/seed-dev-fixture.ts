#!/usr/bin/env tsx
// Dev test fixture seeder for SIGNAL.
// Resets the dev database to a known testing state: coach account preserved,
// 3 pre-linked test clients with varied data designed to exercise every
// Coach Home heuristic rule (no_login, rec_pending_review, moved_interviewing,
// moved_rejected, offer_no_followup, poor_fit_no_rec).
//
// SAFETY GUARDS (no escape hatch):
//   1. SUPABASE_URL must contain dev ref "zydrqckpwidipwbhrfgd". Aborts on
//      prod ref or anything else.
//   2. Requires --confirm flag. Without it, prints plan and exits.
//   3. Prints target URL prominently before any work.
//
// USAGE:
//   COACH_EMAIL=you+dev@example.com \
//     SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//     SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//     npx tsx scripts/seed-dev-fixture.ts            # dry-run
//
//   COACH_EMAIL=you+dev@example.com \
//     SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//     SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//     npx tsx scripts/seed-dev-fixture.ts --confirm  # actually run
//
// IDEMPOTENCY: Re-runnable. Phase 1 wipes by fixture-client email allowlist
// (does NOT touch the coach), Phase 2 ensures coach exists, Phase 3 creates
// all client data fresh.
//
// FIXTURE PASSWORD: All 4 fixture auth users (coach + 3 clients) are set to
// password "dev-test-1234" so you can sign in via the dev-only password
// path on the dashboard sign-in form (gated by NEXT_PUBLIC_DEV_AUTH=true).
// Magic-link sign-in still works as the canonical path.
//
// LIMITATION: auth.users.last_sign_in_at cannot be set via supabase-js admin
// API — it's auto-managed on actual sign-in. This means rule R1 (no_login
// 7+ days) will SKIP fixture clients whose last_sign_in_at is null. Casey's
// no_login trigger documented in the spec depends on this field; in practice
// R1 won't fire on Casey from a fresh fixture run unless someone logs in
// with that account once first. All other rules trigger as designed.

import { createClient, SupabaseClient } from "@supabase/supabase-js"

// ──────────────────────────────────────────────────────────────
// Safety guards (run BEFORE any DB connection or write)
// ──────────────────────────────────────────────────────────────

const DEV_REF = "zydrqckpwidipwbhrfgd"
const PROD_REF = "ejhnokcnahauvrcbcmic"

const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const COACH_EMAIL_RAW = process.env.COACH_EMAIL || process.argv.find((a) => a.startsWith("--coach="))?.slice("--coach=".length) || ""
const COACH_EMAIL = COACH_EMAIL_RAW.trim().toLowerCase()
const CONFIRMED = process.argv.includes("--confirm")

function abort(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

console.log("\n┌────────────────────────────────────────────────────────────┐")
console.log("│              SIGNAL dev fixture seeder                     │")
console.log("└────────────────────────────────────────────────────────────┘\n")
console.log(`Target SUPABASE_URL: ${SUPABASE_URL || "(not set)"}`)
console.log(`Coach email:         ${COACH_EMAIL || "(not set)"}`)
console.log(`Mode:                ${CONFIRMED ? "APPLY (--confirm)" : "DRY-RUN (no --confirm)"}`)
console.log("")

// Guard 1: URL must point at dev
if (!SUPABASE_URL) {
  abort("SUPABASE_URL is required.")
}
if (SUPABASE_URL.includes(PROD_REF)) {
  abort(`REFUSED: SUPABASE_URL contains the PROD project ref (${PROD_REF}). This script is dev-only.`)
}
if (!SUPABASE_URL.includes(DEV_REF)) {
  abort(`REFUSED: SUPABASE_URL must contain the dev project ref (${DEV_REF}). Got URL that doesn't match — refusing to run.`)
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  abort("SUPABASE_SERVICE_ROLE_KEY is required.")
}
if (!COACH_EMAIL) {
  abort("COACH_EMAIL is required (set via env var or --coach=email@example.com).")
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(COACH_EMAIL)) {
  abort(`COACH_EMAIL is not a valid email: ${COACH_EMAIL}`)
}

// Guard 2: --confirm required to actually write
if (!CONFIRMED) {
  console.log("DRY-RUN — would do the following:")
  console.log("  Phase 1: WIPE fixture data for emails:")
  console.log("    alex+test@example.com")
  console.log("    brooke+test@example.com")
  console.log("    casey+test@example.com")
  console.log("    (and their auth users, applications, history, recs, personas, coach_clients links)")
  console.log("  Phase 2: ENSURE coach exists for:", COACH_EMAIL)
  console.log("  Phase 3: CREATE 3 test clients (Alex / Brooke / Casey) with varied data")
  console.log("  Phase 4: VERIFY counts and report")
  console.log("")
  console.log("Re-run with --confirm to actually apply.")
  process.exit(0)
}

// ──────────────────────────────────────────────────────────────
// Fixture spec
// ──────────────────────────────────────────────────────────────

const FIXTURE_CLIENT_EMAILS = [
  "alex+test@example.com",
  "brooke+test@example.com",
  "casey+test@example.com",
] as const

// Default password for all fixture users. Dev only — gated in the UI by
// NEXT_PUBLIC_DEV_AUTH=true, so the password field never renders in prod.
const FIXTURE_PASSWORD = "dev-test-1234"

const sb: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

const MS_DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(Date.now() - n * MS_DAY).toISOString()
const dateAgo = (n: number) => daysAgo(n).slice(0, 10) // YYYY-MM-DD

async function findAuthUserByEmail(email: string): Promise<any | null> {
  let page = 1
  while (true) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers: ${error.message}`)
    if (!data?.users?.length) return null
    const found = data.users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase())
    if (found) return found
    if (data.users.length < 200) return null
    page++
    if (page > 50) return null // safety
  }
}

async function deleteAuthUserByEmail(email: string) {
  const u = await findAuthUserByEmail(email)
  if (!u) return false
  const { error } = await sb.auth.admin.deleteUser(u.id)
  if (error) throw new Error(`deleteUser ${email}: ${error.message}`)
  return true
}

async function logStatus(supabase: SupabaseClient, applicationId: string, fromStatus: string | null, toStatus: string, changedAt: string, changedBy: string) {
  const { error } = await supabase.from("signal_applications_status_history").insert({
    application_id: applicationId,
    from_status: fromStatus,
    to_status: toStatus,
    changed_at: changedAt,
    changed_by: changedBy,
  })
  if (error) throw new Error(`status_history insert: ${error.message}`)
}

// ──────────────────────────────────────────────────────────────
// Phase 1 — Wipe
// ──────────────────────────────────────────────────────────────

async function phase1Wipe(): Promise<void> {
  console.log("── Phase 1: Wipe fixture data ──────────────────────")

  // 1. Resolve fixture client profile_ids
  const { data: profiles } = await sb
    .from("client_profiles")
    .select("id, email, user_id")
    .in("email", [...FIXTURE_CLIENT_EMAILS])
  const fixtureProfileIds = (profiles || []).map((p: any) => p.id)
  console.log(`  ${(profiles || []).length} existing fixture profiles found`)

  // 2. Resolve their applications (for cascade-into-interviews + history)
  let appIds: string[] = []
  if (fixtureProfileIds.length > 0) {
    const { data: apps } = await sb
      .from("signal_applications")
      .select("id")
      .in("profile_id", fixtureProfileIds)
    appIds = (apps || []).map((a: any) => a.id)
    console.log(`  ${appIds.length} existing fixture applications found`)
  }

  // 3. Delete coach_job_recommendations FIRST (FK to client_profiles RESTRICT default)
  if (fixtureProfileIds.length > 0) {
    const { error } = await sb.from("coach_job_recommendations").delete().in("client_profile_id", fixtureProfileIds)
    if (error) throw new Error(`delete coach_job_recommendations: ${error.message}`)
  }

  // 4. coach_annotations (also FK to client_profiles)
  if (fixtureProfileIds.length > 0) {
    const { error } = await sb.from("coach_annotations").delete().in("client_profile_id", fixtureProfileIds)
    if (error) throw new Error(`delete coach_annotations: ${error.message}`)
  }

  // 5. coach_clients — by both invited_email and client_profile_id (handles
  //    pending invites without an attached profile).
  {
    const { error: e1 } = await sb.from("coach_clients").delete().in("invited_email", [...FIXTURE_CLIENT_EMAILS])
    if (e1) throw new Error(`delete coach_clients by email: ${e1.message}`)
    if (fixtureProfileIds.length > 0) {
      const { error: e2 } = await sb.from("coach_clients").delete().in("client_profile_id", fixtureProfileIds)
      if (e2) throw new Error(`delete coach_clients by profile_id: ${e2.message}`)
    }
  }

  // 6. signal_interviews → references applications
  if (appIds.length > 0) {
    const { error } = await sb.from("signal_interviews").delete().in("application_id", appIds)
    if (error) throw new Error(`delete signal_interviews: ${error.message}`)
  }

  // 7. signal_applications (status_history cascades via FK ON DELETE CASCADE)
  if (fixtureProfileIds.length > 0) {
    const { error } = await sb.from("signal_applications").delete().in("profile_id", fixtureProfileIds)
    if (error) throw new Error(`delete signal_applications: ${error.message}`)
  }

  // 8. client_personas (cascades from client_profiles too, but explicit for safety)
  if (fixtureProfileIds.length > 0) {
    const { error } = await sb.from("client_personas").delete().in("profile_id", fixtureProfileIds)
    if (error) throw new Error(`delete client_personas: ${error.message}`)
  }

  // 9. client_profiles
  {
    const { error } = await sb.from("client_profiles").delete().in("email", [...FIXTURE_CLIENT_EMAILS])
    if (error) throw new Error(`delete client_profiles: ${error.message}`)
  }

  // 10. auth.users (one per fixture email; some may not exist)
  for (const email of FIXTURE_CLIENT_EMAILS) {
    const deleted = await deleteAuthUserByEmail(email)
    console.log(`  auth user ${email}: ${deleted ? "deleted" : "(not present)"}`)
  }

  console.log("  ✓ wipe complete\n")
}

// ──────────────────────────────────────────────────────────────
// Phase 2 — Ensure coach exists (preserve across runs)
// ──────────────────────────────────────────────────────────────

async function phase2EnsureCoach(): Promise<string> {
  console.log("── Phase 2: Ensure coach exists ────────────────────")

  // 2a — auth user (with password set on create + on every re-seed)
  let authUser = await findAuthUserByEmail(COACH_EMAIL)
  if (!authUser) {
    const { data, error } = await sb.auth.admin.createUser({
      email: COACH_EMAIL,
      email_confirm: true,
      password: FIXTURE_PASSWORD,
    })
    if (error) throw new Error(`createUser ${COACH_EMAIL}: ${error.message}`)
    authUser = data.user
    console.log(`  auth user CREATED: ${authUser!.id.slice(0, 8)}…  password set`)
  } else {
    // Re-seed: refresh the password so re-runs reset to the known value
    const { error: pwErr } = await sb.auth.admin.updateUserById(authUser.id, {
      password: FIXTURE_PASSWORD,
    })
    if (pwErr) console.warn(`  password reset failed for coach: ${pwErr.message}`)
    console.log(`  auth user found:   ${authUser.id.slice(0, 8)}…  password reset`)
  }

  // 2b — client_profiles row, is_coach=true
  const { data: existing } = await sb
    .from("client_profiles")
    .select("id, is_coach, user_id")
    .eq("email", COACH_EMAIL)
    .maybeSingle()

  if (existing) {
    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (!existing.is_coach) updates.is_coach = true
    if (existing.user_id !== authUser!.id) updates.user_id = authUser!.id
    if (Object.keys(updates).length > 1) {
      await sb.from("client_profiles").update(updates).eq("id", existing.id)
    }
    console.log(`  client_profiles row preserved: ${existing.id.slice(0, 8)}… (is_coach=${existing.is_coach})`)
    return existing.id
  }

  const { data: created, error } = await sb
    .from("client_profiles")
    .insert({
      user_id: authUser!.id,
      email: COACH_EMAIL,
      name: "Test Coach",
      profile_text: "(test fixture coach)",
      is_coach: true,
      coach_org: "Dev Fixture Coach",
      profile_complete: true,
      active: true,
    })
    .select("id")
    .single()
  if (error || !created) throw new Error(`coach client_profiles insert: ${error?.message ?? "no row"}`)
  console.log(`  client_profiles row CREATED: ${created.id.slice(0, 8)}…`)
  console.log("")
  return created.id
}

// ──────────────────────────────────────────────────────────────
// Phase 3 — Create the 3 test clients
// ──────────────────────────────────────────────────────────────

async function createClientCommon(spec: {
  email: string
  name: string
  job_type: string
  target_roles: string
  target_locations: string
  timeline: string
  coach_notes_avoid: string
  coach_notes_strengths: string
  coach_notes_concerns: string
}): Promise<{ profileId: string; userId: string }> {
  // auth user (fresh — Phase 1 deleted any pre-existing)
  const { data: u, error: uErr } = await sb.auth.admin.createUser({
    email: spec.email,
    email_confirm: true,
    password: FIXTURE_PASSWORD,
    user_metadata: { name: spec.name },
  })
  if (uErr || !u?.user) throw new Error(`createUser ${spec.email}: ${uErr?.message}`)

  // client_profiles
  const { data: p, error: pErr } = await sb
    .from("client_profiles")
    .insert({
      user_id: u.user.id,
      email: spec.email,
      name: spec.name,
      job_type: spec.job_type,
      target_roles: spec.target_roles,
      target_locations: spec.target_locations,
      timeline: spec.timeline,
      coach_notes_avoid: spec.coach_notes_avoid || null,
      coach_notes_strengths: spec.coach_notes_strengths || null,
      coach_notes_concerns: spec.coach_notes_concerns || null,
      profile_text: `(test fixture: ${spec.name})`,
      profile_complete: true,
      active: true,
    })
    .select("id")
    .single()
  if (pErr || !p) throw new Error(`client_profiles insert ${spec.email}: ${pErr?.message}`)

  return { profileId: p.id, userId: u.user.id }
}

async function linkCoachClient(coachProfileId: string, clientProfileId: string, clientEmail: string) {
  const { data, error } = await sb
    .from("coach_clients")
    .insert({
      coach_profile_id: coachProfileId,
      client_profile_id: clientProfileId,
      invited_email: clientEmail,
      access_level: "full",
      status: "active",
      accepted_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(`coach_clients link ${clientEmail}: ${error?.message}`)
  return data.id as string
}

// — CLIENT A — Alex (clean baseline) —
async function seedAlex(coachProfileId: string) {
  console.log("  Client A — Alex (clean baseline)")
  const { profileId } = await createClientCommon({
    email: "alex+test@example.com",
    name: "Test Client Alex",
    job_type: "Full-time",
    target_roles: "Product Manager",
    target_locations: "Remote",
    timeline: "Actively looking",
    coach_notes_avoid: "",
    coach_notes_strengths: "Strong in B2B SaaS, technical PM background",
    coach_notes_concerns: "",
  })
  await linkCoachClient(coachProfileId, profileId, "alex+test@example.com")
  // 1 persona, default
  await sb.from("client_personas").insert({
    profile_id: profileId,
    name: "Alex's Resume",
    resume_text: "(test resume content for Alex)",
    is_default: true,
    display_order: 1,
  })
  // 0 applications, 0 recs — done
  return profileId
}

// — CLIENT B — Brooke (active mid-engagement) —
async function seedBrooke(coachProfileId: string) {
  console.log("  Client B — Brooke (active mid-engagement)")
  const { profileId } = await createClientCommon({
    email: "brooke+test@example.com",
    name: "Test Client Brooke",
    job_type: "Full-time",
    target_roles: "Marketing Director, Brand Manager",
    target_locations: "NYC, Remote",
    timeline: "Within 1 month",
    coach_notes_avoid: "No agency roles",
    coach_notes_strengths: "10 years brand marketing, consumer products focus",
    coach_notes_concerns: "Wants to pivot from CPG to tech — needs strong narrative",
  })
  const coachClientId = await linkCoachClient(coachProfileId, profileId, "brooke+test@example.com")

  // 2 personas
  const { data: marketingPersona } = await sb
    .from("client_personas")
    .insert({
      profile_id: profileId,
      name: "Marketing Resume",
      resume_text: "(test resume content — marketing focused)",
      is_default: true,
      display_order: 1,
    })
    .select("id")
    .single()
  await sb.from("client_personas").insert({
    profile_id: profileId,
    name: "Operations Resume",
    resume_text: "(test resume content — ops focused)",
    is_default: false,
    display_order: 2,
  })

  // 8 applications — see spec
  const apps: Array<{
    company: string
    title: string
    status: "saved" | "applied" | "interviewing" | "offer"
    created_days_ago: number
    transitions: Array<{ from: string | null; to: string; days_ago: number }>
    applied_date_days_ago?: number
  }> = [
    // 3 saved (within 7 days)
    { company: "Glossier", title: "Senior Brand Manager", status: "saved", created_days_ago: 2, transitions: [{ from: null, to: "saved", days_ago: 2 }] },
    { company: "Allbirds", title: "Director of Marketing", status: "saved", created_days_ago: 4, transitions: [{ from: null, to: "saved", days_ago: 4 }] },
    { company: "Warby Parker", title: "VP of Brand", status: "saved", created_days_ago: 6, transitions: [{ from: null, to: "saved", days_ago: 6 }] },
    // 2 applied (created 5-10 days ago, applied within 7 days)
    {
      company: "Patagonia", title: "Brand Director", status: "applied",
      created_days_ago: 9, applied_date_days_ago: 5,
      transitions: [
        { from: null, to: "saved", days_ago: 9 },
        { from: "saved", to: "applied", days_ago: 5 },
      ],
    },
    {
      company: "Mejuri", title: "Marketing Director", status: "applied",
      created_days_ago: 7, applied_date_days_ago: 3,
      transitions: [
        { from: null, to: "saved", days_ago: 7 },
        { from: "saved", to: "applied", days_ago: 3 },
      ],
    },
    // 2 interviewing (status changed yesterday, NOT stale)
    {
      company: "Headspace", title: "VP Marketing", status: "interviewing",
      created_days_ago: 4, applied_date_days_ago: 2,
      transitions: [
        { from: null, to: "saved", days_ago: 4 },
        { from: "saved", to: "applied", days_ago: 2 },
        { from: "applied", to: "interviewing", days_ago: 1 },
      ],
    },
    {
      company: "Calm", title: "Senior Brand Manager", status: "interviewing",
      created_days_ago: 5, applied_date_days_ago: 3,
      transitions: [
        { from: null, to: "saved", days_ago: 5 },
        { from: "saved", to: "applied", days_ago: 3 },
        { from: "applied", to: "interviewing", days_ago: 1 },
      ],
    },
    // 1 offer (status changed today, NOT stale)
    {
      company: "Notion", title: "Marketing Director", status: "offer",
      created_days_ago: 12, applied_date_days_ago: 8,
      transitions: [
        { from: null, to: "saved", days_ago: 12 },
        { from: "saved", to: "applied", days_ago: 8 },
        { from: "applied", to: "interviewing", days_ago: 3 },
        { from: "interviewing", to: "offer", days_ago: 0 },
      ],
    },
  ]

  const insertedAppIds: Record<string, string> = {}
  for (const a of apps) {
    const { data: row, error } = await sb
      .from("signal_applications")
      .insert({
        profile_id: profileId,
        persona_id: marketingPersona?.id ?? null,
        company_name: a.company,
        job_title: a.title,
        application_status: a.status,
        applied_date: a.applied_date_days_ago !== undefined ? dateAgo(a.applied_date_days_ago) : null,
        created_at: daysAgo(a.created_days_ago),
        signal_score: 75,
      })
      .select("id")
      .single()
    if (error || !row) throw new Error(`Brooke app insert: ${error?.message}`)
    insertedAppIds[a.company] = row.id
    for (const t of a.transitions) {
      await logStatus(sb, row.id, t.from, t.to, daysAgo(t.days_ago), profileId)
    }
  }

  // 2 coach_job_recommendations — 1 acted on (2d), 1 pending NOT stale (1d)
  await sb.from("coach_job_recommendations").insert({
    coach_client_id: coachClientId,
    coach_profile_id: coachProfileId,
    client_profile_id: profileId,
    company_name: "Lululemon",
    job_title: "Senior Brand Manager",
    job_description: "(test recommendation — brand manager role)",
    priority: "this_week",
    recommended_action: "apply",
    coaching_note: "Strong fit — apply this week.",
    client_status: "applied",
    client_responded_at: daysAgo(2),
    created_at: daysAgo(4),
  })
  await sb.from("coach_job_recommendations").insert({
    coach_client_id: coachClientId,
    coach_profile_id: coachProfileId,
    client_profile_id: profileId,
    company_name: "Klaviyo",
    job_title: "Director, Brand Marketing",
    job_description: "(test recommendation — brand director role)",
    priority: "this_week",
    recommended_action: "apply",
    coaching_note: "Worth a look this week.",
    client_status: "new",
    client_responded_at: null,
    created_at: daysAgo(1),
  })

  return profileId
}

// — CLIENT C — Casey (stale, multi-rule trigger) —
async function seedCasey(coachProfileId: string) {
  console.log("  Client C — Casey (stale, multi-rule trigger)")
  const { profileId } = await createClientCommon({
    email: "casey+test@example.com",
    name: "Test Client Casey",
    job_type: "Full-time",
    target_roles: "Software Engineer",
    target_locations: "Bay Area",
    timeline: "1-3 months",
    coach_notes_avoid: "No early-stage startups",
    coach_notes_strengths: "Senior IC, distributed systems, infrastructure",
    coach_notes_concerns: "Compensation expectations need adjustment for current market",
  })
  const coachClientId = await linkCoachClient(coachProfileId, profileId, "casey+test@example.com")

  const { data: persona } = await sb
    .from("client_personas")
    .insert({
      profile_id: profileId,
      name: "Casey's Resume",
      resume_text: "(test resume content for Casey — distributed systems)",
      is_default: true,
      display_order: 1,
    })
    .select("id")
    .single()

  // 5 applications — designed to trigger R3-R6
  const apps: Array<{
    company: string
    title: string
    status: "saved" | "applied" | "interviewing" | "rejected" | "offer"
    created_days_ago: number
    signal_score: number | null
    applied_date_days_ago?: number
    transitions: Array<{ from: string | null; to: string; days_ago: number }>
  }> = [
    // R6 trigger: poor-fit app 8 days ago, no coach rec
    {
      company: "Wells Fargo", title: "Software Engineer III",
      status: "saved", created_days_ago: 8, signal_score: 45,
      transitions: [{ from: null, to: "saved", days_ago: 8 }],
    },
    // No-rule app: applied 9 days ago
    {
      company: "Snowflake", title: "Senior Software Engineer",
      status: "applied", created_days_ago: 12, signal_score: 78,
      applied_date_days_ago: 9,
      transitions: [
        { from: null, to: "saved", days_ago: 12 },
        { from: "saved", to: "applied", days_ago: 9 },
      ],
    },
    // R3 trigger: moved to interviewing 4 days ago, no coach view since
    {
      company: "Stripe", title: "Staff Software Engineer",
      status: "interviewing", created_days_ago: 14, signal_score: 82,
      applied_date_days_ago: 7,
      transitions: [
        { from: null, to: "saved", days_ago: 14 },
        { from: "saved", to: "applied", days_ago: 7 },
        { from: "applied", to: "interviewing", days_ago: 4 },
      ],
    },
    // R4 trigger: rejected 5 days ago, no acknowledgment
    {
      company: "Cloudflare", title: "Senior Engineer, Distributed Systems",
      status: "rejected", created_days_ago: 15, signal_score: 71,
      applied_date_days_ago: 8,
      transitions: [
        { from: null, to: "saved", days_ago: 15 },
        { from: "saved", to: "applied", days_ago: 8 },
        { from: "applied", to: "rejected", days_ago: 5 },
      ],
    },
    // R5 trigger: offer 2 days ago, no follow-up
    {
      company: "Vercel", title: "Staff Engineer, Infrastructure",
      status: "offer", created_days_ago: 18, signal_score: 88,
      applied_date_days_ago: 12,
      transitions: [
        { from: null, to: "saved", days_ago: 18 },
        { from: "saved", to: "applied", days_ago: 12 },
        { from: "applied", to: "interviewing", days_ago: 5 },
        { from: "interviewing", to: "offer", days_ago: 2 },
      ],
    },
  ]

  for (const a of apps) {
    const { data: row, error } = await sb
      .from("signal_applications")
      .insert({
        profile_id: profileId,
        persona_id: persona?.id ?? null,
        company_name: a.company,
        job_title: a.title,
        application_status: a.status,
        applied_date: a.applied_date_days_ago !== undefined ? dateAgo(a.applied_date_days_ago) : null,
        created_at: daysAgo(a.created_days_ago),
        signal_score: a.signal_score,
      })
      .select("id")
      .single()
    if (error || !row) throw new Error(`Casey app insert: ${error?.message}`)
    for (const t of a.transitions) {
      await logStatus(sb, row.id, t.from, t.to, daysAgo(t.days_ago), profileId)
    }
  }

  // 3 coach_job_recommendations — all stale 5+ days, all unresponded
  // (rule R2 dedupes to 1 item per client — exercise that path)
  for (const [i, rec] of [
    { company: "Datadog", title: "Senior Platform Engineer", days_ago: 7 },
    { company: "Coinbase", title: "Staff Software Engineer", days_ago: 6 },
    { company: "Roblox", title: "Senior Engineer, Distributed Systems", days_ago: 5 },
  ].entries()) {
    await sb.from("coach_job_recommendations").insert({
      coach_client_id: coachClientId,
      coach_profile_id: coachProfileId,
      client_profile_id: profileId,
      company_name: rec.company,
      job_title: rec.title,
      job_description: `(test recommendation #${i + 1} — ${rec.title})`,
      priority: "this_week",
      recommended_action: "apply",
      coaching_note: "Worth pursuing.",
      client_status: "new",
      client_responded_at: null,
      created_at: daysAgo(rec.days_ago),
    })
  }

  // last_sign_in_at — cannot be set via supabase-js admin API.
  // R1 (no_login 7+ days) will SKIP Casey because last_sign_in_at is null.
  // Documented limitation in script header.

  return profileId
}

async function phase3SeedClients(coachProfileId: string): Promise<string[]> {
  console.log("── Phase 3: Seed test clients ──────────────────────")
  const ids = [
    await seedAlex(coachProfileId),
    await seedBrooke(coachProfileId),
    await seedCasey(coachProfileId),
  ]
  console.log(`  ✓ all 3 clients seeded\n`)
  return ids
}

// ──────────────────────────────────────────────────────────────
// Phase 4 — Verify counts
// ──────────────────────────────────────────────────────────────

async function phase4Verify(): Promise<void> {
  console.log("── Phase 4: Verify counts ──────────────────────────")

  const checks = [
    { label: "client_profiles is_coach=true", q: () => sb.from("client_profiles").select("*", { count: "exact", head: true }).eq("is_coach", true), expected: ">=1" },
    { label: "client_profiles fixture clients", q: () => sb.from("client_profiles").select("*", { count: "exact", head: true }).in("email", [...FIXTURE_CLIENT_EMAILS]), expected: "3" },
    { label: "coach_clients (active fixture)", q: () => sb.from("coach_clients").select("*", { count: "exact", head: true }).in("invited_email", [...FIXTURE_CLIENT_EMAILS]), expected: "3" },
    { label: "client_personas (fixture)", q: async () => {
      const { data: ps } = await sb.from("client_profiles").select("id").in("email", [...FIXTURE_CLIENT_EMAILS])
      const ids = (ps || []).map((p: any) => p.id)
      return sb.from("client_personas").select("*", { count: "exact", head: true }).in("profile_id", ids)
    }, expected: "4 (1+2+1)" },
    { label: "signal_applications (fixture)", q: async () => {
      const { data: ps } = await sb.from("client_profiles").select("id").in("email", [...FIXTURE_CLIENT_EMAILS])
      const ids = (ps || []).map((p: any) => p.id)
      return sb.from("signal_applications").select("*", { count: "exact", head: true }).in("profile_id", ids)
    }, expected: "13 (0+8+5)" },
    { label: "coach_job_recommendations (fixture)", q: async () => {
      const { data: ps } = await sb.from("client_profiles").select("id").in("email", [...FIXTURE_CLIENT_EMAILS])
      const ids = (ps || []).map((p: any) => p.id)
      return sb.from("coach_job_recommendations").select("*", { count: "exact", head: true }).in("client_profile_id", ids)
    }, expected: "5 (0+2+3)" },
    { label: "signal_applications_status_history (fixture)", q: async () => {
      const { data: ps } = await sb.from("client_profiles").select("id").in("email", [...FIXTURE_CLIENT_EMAILS])
      const profileIds = (ps || []).map((p: any) => p.id)
      const { data: apps } = await sb.from("signal_applications").select("id").in("profile_id", profileIds)
      const appIds = (apps || []).map((a: any) => a.id)
      return sb.from("signal_applications_status_history").select("*", { count: "exact", head: true }).in("application_id", appIds)
    }, expected: "30 (3+4+6+4=17 Brooke + 1+2+3+3+4=13 Casey)" },
  ]

  for (const c of checks) {
    const { count, error } = await c.q()
    console.log(`  ${c.label.padEnd(45)} actual=${count ?? "?"}  expected=${c.expected}${error ? `  ERROR: ${error.message}` : ""}`)
  }
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────

async function main() {
  try {
    await phase1Wipe()
    const coachProfileId = await phase2EnsureCoach()
    await phase3SeedClients(coachProfileId)
    await phase4Verify()
    console.log("")
    console.log(`✓ Fixture seeded. All fixture users have password: ${FIXTURE_PASSWORD}`)
    console.log(`  Sign in to dev as ${COACH_EMAIL} via magic link OR password to test.`)
    console.log(`  Password sign-in requires NEXT_PUBLIC_DEV_AUTH=true in dev env.`)
  } catch (e: any) {
    console.error(`\n✗ Fatal: ${e.message}`)
    if (e.stack) console.error(e.stack.split("\n").slice(0, 5).join("\n"))
    process.exit(1)
  }
}

main()
