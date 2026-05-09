#!/usr/bin/env tsx
// Phase 4 + Item 7 backend verification — cross-client action items
// endpoint. Seeds known action items spread across the 3 fixture
// clients (Alex/Brooke/Casey) plus exclusion-test rows, hits the new
// /api/coach/action-items endpoint, asserts sort + scope + filtering,
// cleans up.
//
// SAFETY GUARDS (mirror seed-dev-fixture.ts and Phase 2 verify):
//   1. SUPABASE_URL must contain dev ref. Aborts on prod.
//   2. Cleanup runs in success + error paths.
//
// USAGE:
//   SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//     SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//     COACH_EMAIL=peri+coach1@workforcereadynow.com \
//     npx tsx scripts/verify-action-items-2026-05-09.ts

import { createClient, SupabaseClient } from "@supabase/supabase-js"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const PROD_REF = "ejhnokcnahauvrcbcmic"

const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const COACH_EMAIL = (process.env.COACH_EMAIL || "").trim().toLowerCase()
const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL
const NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
const TEST_PASSWORD = "dev-test-1234"
const ENDPOINT_BASE = process.env.ENDPOINT_BASE || "http://localhost:3000"

const TAG = "[verify-action-items 2026-05-09]"

function abort(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

if (!SUPABASE_URL) abort("SUPABASE_URL is required")
if (SUPABASE_URL.includes(PROD_REF)) abort(`REFUSED: SUPABASE_URL contains the PROD ref (${PROD_REF}). Dev only.`)
if (!SUPABASE_URL.includes(DEV_REF)) abort(`REFUSED: SUPABASE_URL must contain dev ref (${DEV_REF}).`)
if (!SUPABASE_SERVICE_ROLE_KEY) abort("SUPABASE_SERVICE_ROLE_KEY is required")
if (!NEXT_PUBLIC_SUPABASE_ANON_KEY) abort("NEXT_PUBLIC_SUPABASE_ANON_KEY is required (sign-in path)")
if (!COACH_EMAIL) abort("COACH_EMAIL is required")

const sb: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const anon: SupabaseClient = createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, this_week: 1, when_ready: 2 }

let seededIds: string[] = []
let pass = true

type FixturePlan = {
  clientEmail: string
  type: "action_item" | "session_recap" | "other"
  priority: "urgent" | "this_week" | "when_ready" | null
  body: string
  completed_at: string | null
  deleted_at: string | null
  // Higher offset = more recent (newer created_at).
  offset: number
}

// Spread across 3 clients. Includes exclusion-test rows that should
// NEVER appear in the response.
const FIXTURES: FixturePlan[] = [
  // Alex — 2 urgents, 1 this_week
  { clientEmail: "alex+test@example.com",   type: "action_item", priority: "urgent",     body: `${TAG} alex urgent newer`, completed_at: null, deleted_at: null, offset: 11 },
  { clientEmail: "alex+test@example.com",   type: "action_item", priority: "urgent",     body: `${TAG} alex urgent older`, completed_at: null, deleted_at: null, offset: 6 },
  { clientEmail: "alex+test@example.com",   type: "action_item", priority: "this_week",  body: `${TAG} alex this_week`,    completed_at: null, deleted_at: null, offset: 4 },
  // Brooke — 1 this_week (newest of all this_weeks), 1 when_ready
  { clientEmail: "brooke+test@example.com", type: "action_item", priority: "this_week",  body: `${TAG} brooke this_week`,  completed_at: null, deleted_at: null, offset: 9 },
  { clientEmail: "brooke+test@example.com", type: "action_item", priority: "when_ready", body: `${TAG} brooke when_ready`, completed_at: null, deleted_at: null, offset: 3 },
  // Casey — 1 urgent (sandwiched between alex's two urgents by time)
  { clientEmail: "casey+test@example.com",  type: "action_item", priority: "urgent",     body: `${TAG} casey urgent mid`,  completed_at: null, deleted_at: null, offset: 8 },
  // Exclusion tests
  { clientEmail: "alex+test@example.com",   type: "action_item",  priority: "urgent",    body: `${TAG} EXCL completed`,   completed_at: new Date().toISOString(), deleted_at: null, offset: 12 },
  { clientEmail: "brooke+test@example.com", type: "action_item",  priority: "urgent",    body: `${TAG} EXCL deleted`,     completed_at: null, deleted_at: new Date().toISOString(), offset: 13 },
  { clientEmail: "casey+test@example.com",  type: "session_recap", priority: null,        body: `${TAG} EXCL recap`,       completed_at: null, deleted_at: null, offset: 14 },
  { clientEmail: "casey+test@example.com",  type: "other",         priority: null,        body: `${TAG} EXCL other`,       completed_at: null, deleted_at: null, offset: 15 },
]

const EXCL_MARKERS = ["EXCL completed", "EXCL deleted", "EXCL recap", "EXCL other"]

// Expected sort across all-priorities (urgent → this_week → when_ready,
// then created_at DESC within each):
//   urgent:     alex urgent newer (11) → casey urgent mid (8) → alex urgent older (6)
//   this_week:  brooke this_week (9) → alex this_week (4)
//   when_ready: brooke when_ready (3)
const EXPECTED_ALL_BODIES = [
  `${TAG} alex urgent newer`,
  `${TAG} casey urgent mid`,
  `${TAG} alex urgent older`,
  `${TAG} brooke this_week`,
  `${TAG} alex this_week`,
  `${TAG} brooke when_ready`,
]

// Filtered to urgent + this_week (Item 7's Coach Home query):
const EXPECTED_FILTERED_BODIES = [
  `${TAG} alex urgent newer`,
  `${TAG} casey urgent mid`,
  `${TAG} alex urgent older`,
  `${TAG} brooke this_week`,
  `${TAG} alex this_week`,
]

async function lookup() {
  const { data: coach, error: ce } = await sb
    .from("client_profiles")
    .select("id, email, name, is_coach")
    .eq("email", COACH_EMAIL)
    .maybeSingle()
  if (ce || !coach) abort(`Coach not found: ${COACH_EMAIL}`)
  if (!coach.is_coach) abort(`Profile ${COACH_EMAIL} is not flagged is_coach=true`)

  const emails = ["alex+test@example.com", "brooke+test@example.com", "casey+test@example.com"]
  const { data: clients } = await sb
    .from("client_profiles")
    .select("id, email, name")
    .in("email", emails)
  if (!clients || clients.length !== 3) abort(`Expected 3 fixture clients, got ${clients?.length ?? 0}`)
  const clientByEmail = new Map<string, { id: string; name: string | null }>()
  for (const c of clients) clientByEmail.set(c.email as string, { id: c.id as string, name: c.name as string | null })

  const { data: links } = await sb
    .from("coach_clients")
    .select("id, client_profile_id, status")
    .eq("coach_profile_id", coach.id)
    .eq("status", "active")
  const linkByClientId = new Map<string, string>()
  for (const l of links ?? []) linkByClientId.set(l.client_profile_id as string, l.id as string)
  for (const c of clients) {
    if (!linkByClientId.has(c.id as string)) abort(`No active coach_clients link for ${c.email}`)
  }

  return { coach, clientByEmail, linkByClientId }
}

async function seed(coachId: string, clientByEmail: Map<string, { id: string; name: string | null }>, linkByClientId: Map<string, string>) {
  const baseTime = Date.now()
  for (const f of FIXTURES) {
    const client = clientByEmail.get(f.clientEmail)!
    const linkId = linkByClientId.get(client.id)!
    const createdAt = new Date(baseTime - (16 - f.offset) * 1000).toISOString()
    const { data, error } = await sb
      .from("coach_client_notes")
      .insert({
        coach_client_id: linkId,
        coach_profile_id: coachId,
        client_profile_id: client.id,
        type: f.type,
        body: f.body,
        priority: f.priority,
        completed_at: f.completed_at,
        deleted_at: f.deleted_at,
        created_at: createdAt,
        updated_at: createdAt,
      })
      .select("id")
      .single()
    if (error || !data) {
      console.error(`✗ seed failed: ${f.body} — ${error?.message}`)
      pass = false
      return
    }
    seededIds.push(data.id as string)
  }
  console.log(`✓ Seeded ${seededIds.length} fixture rows across 3 clients`)
}

async function getCoachToken() {
  const { data, error } = await anon.auth.signInWithPassword({
    email: COACH_EMAIL,
    password: TEST_PASSWORD,
  })
  if (error || !data?.session?.access_token) abort(`Sign-in failed for ${COACH_EMAIL}: ${error?.message}`)
  return data.session.access_token
}

async function callEndpoint(token: string, query: string) {
  const res = await fetch(`${ENDPOINT_BASE}/api/coach/action-items${query}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

function assertOrder(label: string, items: any[], expected: string[]) {
  const ours = items.filter((i: any) => typeof i.body === "string" && i.body.includes(TAG))
  console.log(`\n[${label}] returned ${items.length} total, ${ours.length} of ours`)
  if (ours.length !== expected.length) {
    console.error(`✗ expected ${expected.length} of ours, got ${ours.length}`)
    pass = false
  }
  for (const m of EXCL_MARKERS) {
    const found = ours.find((i) => i.body.includes(m))
    if (found) {
      console.error(`✗ excluded marker present: ${m}`)
      pass = false
    } else {
      console.log(`  ✓ excluded: ${m}`)
    }
  }
  for (let i = 0; i < expected.length; i++) {
    const want = expected[i]
    const got = ours[i]?.body
    if (got !== want) {
      console.error(`✗ position ${i}: want "${want}", got "${got}"`)
      pass = false
    } else {
      console.log(`  ✓ position ${i}: ${want}  [${ours[i].priority}]  client=${ours[i].client_name ?? "?"}`)
    }
  }
  // Spot-check shape on the first row
  if (ours[0]) {
    for (const k of ["note_id", "body", "priority", "created_at", "client_id", "client_name", "client_email"]) {
      if (!(k in ours[0])) {
        console.error(`✗ shape missing key: ${k}`)
        pass = false
      }
    }
  }
}

async function authzCheck() {
  // Hit without bearer token → expect 401
  const r1 = await fetch(`${ENDPOINT_BASE}/api/coach/action-items`)
  if (r1.status !== 401) {
    console.error(`✗ no-token expected 401, got ${r1.status}`)
    pass = false
  } else {
    console.log("  ✓ no token → 401")
  }

  // Hit with non-coach token (a fixture client) → expect 403
  const { data: clientLogin } = await anon.auth.signInWithPassword({
    email: "alex+test@example.com",
    password: TEST_PASSWORD,
  })
  if (clientLogin?.session?.access_token) {
    const r2 = await fetch(`${ENDPOINT_BASE}/api/coach/action-items`, {
      headers: { authorization: `Bearer ${clientLogin.session.access_token}` },
    })
    if (r2.status !== 403) {
      console.error(`✗ non-coach expected 403, got ${r2.status}`)
      pass = false
    } else {
      console.log("  ✓ non-coach token → 403")
    }
  } else {
    console.log("  · skipping non-coach 403 check (couldn't sign in as alex+test)")
  }
}

async function cleanup() {
  if (seededIds.length === 0) return
  const { error } = await sb.from("coach_client_notes").delete().in("id", seededIds)
  if (error) {
    console.error(`✗ cleanup failed (${seededIds.length} rows may remain): ${error.message}`)
    return
  }
  console.log(`✓ cleaned up ${seededIds.length} fixture rows`)
}

async function main() {
  console.log("┌──────────────────────────────────────────────────────────────┐")
  console.log("│ Phase 4 / Item 7 — cross-client action items verification    │")
  console.log("└──────────────────────────────────────────────────────────────┘")
  console.log(`Target: ${SUPABASE_URL}`)
  console.log(`Endpoint: ${ENDPOINT_BASE}`)
  console.log(`Coach: ${COACH_EMAIL}\n`)

  const { coach, clientByEmail, linkByClientId } = await lookup()

  console.log("--- SEEDING ---")
  await seed(coach.id as string, clientByEmail, linkByClientId)

  console.log("\n--- AUTH ---")
  const token = await getCoachToken()
  console.log(`✓ got coach bearer token (length=${token.length})`)

  console.log("\n--- ALL PRIORITIES ---")
  const r1 = await callEndpoint(token, "")
  if (r1.status !== 200 || !r1.body?.ok) {
    console.error(`✗ unfiltered call status=${r1.status}`, r1.body)
    pass = false
  } else {
    assertOrder("all", r1.body.items, EXPECTED_ALL_BODIES)
  }

  console.log("\n--- FILTERED urgent + this_week (Item 7 query) ---")
  const r2 = await callEndpoint(token, "?priorities=urgent,this_week")
  if (r2.status !== 200 || !r2.body?.ok) {
    console.error(`✗ filtered call status=${r2.status}`, r2.body)
    pass = false
  } else {
    assertOrder("urgent+this_week", r2.body.items, EXPECTED_FILTERED_BODIES)
  }

  console.log("\n--- INVALID priority filter ---")
  const r3 = await callEndpoint(token, "?priorities=urgent,bogus")
  if (r3.status !== 400) {
    console.error(`✗ invalid filter expected 400, got ${r3.status}`)
    pass = false
  } else {
    console.log("  ✓ invalid filter → 400")
  }

  console.log("\n--- AUTHZ ---")
  await authzCheck()

  console.log("\n--- CLEANUP ---")
  await cleanup()

  console.log(`\n${pass ? "✓ ALL CHECKS PASSED" : "✗ SOME CHECKS FAILED"}`)
  process.exit(pass ? 0 : 1)
}

main().catch(async (err) => {
  console.error("✗ unhandled error:", err)
  await cleanup()
  process.exit(1)
})
