#!/usr/bin/env tsx
// One-off seeder for a single non-coach magic-link test user in dev.
// Mirrors seed-dev-fixture.ts pattern (admin API + service-role inserts).
//
// SAFETY GUARDS:
//   1. SUPABASE_URL must contain dev ref "zydrqckpwidipwbhrfgd". Aborts on
//      prod ref or anything else.
//   2. Requires --confirm flag. Without it, prints plan and exits.
//
// USAGE:
//   SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//     SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//     npx tsx scripts/seed-peri-test100.ts            # dry-run
//
//   SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//     SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//     npx tsx scripts/seed-peri-test100.ts --confirm  # actually apply
//
// One-shot — not idempotent. Re-running with --confirm after the user exists
// will fail on the auth.users email-uniqueness constraint.

import { createClient } from "@supabase/supabase-js"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const PROD_REF = "ejhnokcnahauvrcbcmic"
const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const CONFIRMED = process.argv.includes("--confirm")

function abort(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const EMAIL = "peri+test100@workforcereadynow.com"
const NAME = "Test User Peri 100"

console.log("\n┌────────────────────────────────────────────────────────────┐")
console.log("│         seed-peri-test100 — single non-coach user          │")
console.log("└────────────────────────────────────────────────────────────┘\n")
console.log(`Target SUPABASE_URL: ${SUPABASE_URL || "(not set)"}`)
console.log(`Email:               ${EMAIL}`)
console.log(`Name:                ${NAME}`)
console.log(`Mode:                ${CONFIRMED ? "APPLY (--confirm)" : "DRY-RUN (no --confirm)"}`)
console.log("")

if (!SUPABASE_URL) abort("SUPABASE_URL is required.")
if (SUPABASE_URL.includes(PROD_REF)) abort(`REFUSED: SUPABASE_URL contains the PROD project ref (${PROD_REF}).`)
if (!SUPABASE_URL.includes(DEV_REF)) abort(`REFUSED: SUPABASE_URL must contain the dev project ref (${DEV_REF}).`)
if (!SUPABASE_SERVICE_ROLE_KEY) abort("SUPABASE_SERVICE_ROLE_KEY is required.")

if (!CONFIRMED) {
  console.log("DRY-RUN — would do the following:")
  console.log("  1. auth.admin.createUser:")
  console.log(`       email=${EMAIL}, email_confirm=true, user_metadata.name=${NAME}`)
  console.log("       NO password — magic-link / OTP only")
  console.log("  2. INSERT into client_profiles:")
  console.log("       user_id=<new auth user id>, email, name,")
  console.log("       job_type='Full-time', target_roles='Product Manager',")
  console.log("       target_locations='Remote', timeline='Actively looking',")
  console.log("       profile_text='(test fixture: Test User Peri 100)',")
  console.log("       profile_complete=true, active=true, is_coach=false")
  console.log("  3. INSERT into client_personas:")
  console.log("       profile_id=<new client_profile id>, name=\"Peri's Resume\",")
  console.log("       resume_text='(test resume content for Peri)',")
  console.log("       is_default=true, display_order=1")
  console.log("")
  console.log("Re-run with --confirm to actually apply.")
  process.exit(0)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  // 1. Auth user — NO password = magic-link / OTP only. email_confirm: true
  //    skips Supabase's confirmation email so the only inbox traffic is the
  //    magic link triggered from the sign-in form.
  const { data: u, error: uErr } = await sb.auth.admin.createUser({
    email: EMAIL,
    email_confirm: true,
    user_metadata: { name: NAME },
  })
  if (uErr || !u?.user) throw new Error(`createUser: ${uErr?.message}`)
  console.log(`  auth user created:      ${u.user.id}`)

  // 2. client_profiles — mirrors Alex's clean-baseline fields.
  //    profile_complete=true so magic-link redirect lands on /dashboard/tracker.
  const { data: p, error: pErr } = await sb
    .from("client_profiles")
    .insert({
      user_id: u.user.id,
      email: EMAIL,
      name: NAME,
      job_type: "Full-time",
      target_roles: "Product Manager",
      target_locations: "Remote",
      timeline: "Actively looking",
      profile_text: `(test fixture: ${NAME})`,
      profile_complete: true,
      active: true,
      is_coach: false,
    })
    .select("id")
    .single()
  if (pErr || !p) throw new Error(`client_profiles insert: ${pErr?.message}`)
  console.log(`  client_profile created: ${p.id}`)

  // 3. Default persona — Positioning v2 start route F6 guard returns 400
  //    'no_persona_configured' without one. Placeholder resume_text is fine
  //    for verifying response shapes; replace with real content if using this
  //    user for scoring-quality evaluation later.
  const { data: pers, error: persErr } = await sb
    .from("client_personas")
    .insert({
      profile_id: p.id,
      name: "Peri's Resume",
      resume_text: "(test resume content for Peri)",
      is_default: true,
      display_order: 1,
    })
    .select("id")
    .single()
  if (persErr || !pers) throw new Error(`client_personas insert: ${persErr?.message}`)
  console.log(`  persona created:        ${pers.id}`)

  console.log(`\n✓ Seeded ${EMAIL}.`)
  console.log("  Sign in by submitting the email to the dashboard sign-in form;")
  console.log("  magic link arrives at peri+test100@workforcereadynow.com.")
}

main().catch((e) => {
  console.error(`\n✗ Fatal: ${e.message}`)
  if (e.stack) console.error(e.stack.split("\n").slice(0, 5).join("\n"))
  process.exit(1)
})
