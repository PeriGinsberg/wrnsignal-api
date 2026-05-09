#!/usr/bin/env tsx
// Phase 2 verification — exercises the per-client needs-attention query
// against dev fixtures with seeded action items, asserts sort order and
// exclusions, and cleans up after itself.
//
// SAFETY GUARDS (mirror seed-dev-fixture.ts):
//   1. SUPABASE_URL must contain dev ref. Aborts on prod.
//   2. Cleanup runs in a finally block; failure path still removes seeded rows.
//
// USAGE:
//   SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//     SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//     COACH_EMAIL=peri+dev@example.com \
//     CLIENT_EMAIL=alex+test@example.com \
//     npx tsx scripts/verify-needs-attention-2026-05-09.ts
//
// What it does:
//   1. Looks up the coach + chosen client via coach_clients link
//   2. Inserts 7 fixture notes spanning all priority/state combinations
//   3. Re-runs the same query the route runs (priority ASC index path)
//   4. Applies the same JS sort the route applies
//   5. Asserts: sort order, exclusions, response shape
//   6. Deletes all seeded rows by tagged body marker

import { createClient, SupabaseClient } from "@supabase/supabase-js"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const PROD_REF = "ejhnokcnahauvrcbcmic"

const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const COACH_EMAIL = (process.env.COACH_EMAIL || "").trim().toLowerCase()
const CLIENT_EMAIL = (process.env.CLIENT_EMAIL || "alex+test@example.com").trim().toLowerCase()

const TAG = "[verify-needs-attention 2026-05-09]"

function abort(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

if (!SUPABASE_URL) abort("SUPABASE_URL is required")
if (SUPABASE_URL.includes(PROD_REF)) abort(`REFUSED: SUPABASE_URL contains the PROD ref (${PROD_REF}). Dev only.`)
if (!SUPABASE_URL.includes(DEV_REF)) abort(`REFUSED: SUPABASE_URL must contain dev ref (${DEV_REF}).`)
if (!SUPABASE_SERVICE_ROLE_KEY) abort("SUPABASE_SERVICE_ROLE_KEY is required")
if (!COACH_EMAIL) abort("COACH_EMAIL is required")

const sb: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, this_week: 1, when_ready: 2 }

type FixtureNote = {
  type: "action_item" | "session_recap" | "other"
  body: string
  priority: string | null
  completed_at: string | null
  deleted_at: string | null
  // Higher created_offset = newer (smaller created_at age)
  created_offset_seconds: number
}

// 7 fixtures spanning priority/state space:
//   3 urgent action items (newest → oldest by offset)
//   2 this_week action items
//   1 when_ready action item
//   1 completed urgent action item — should be EXCLUDED
//   1 soft-deleted urgent action item — should be EXCLUDED
//   1 session_recap with action-item-shaped body — should be EXCLUDED
//   1 other with body — should be EXCLUDED
const FIXTURES: FixtureNote[] = [
  { type: "action_item", body: `${TAG} URGENT newest`,    priority: "urgent",     completed_at: null, deleted_at: null, created_offset_seconds: 6 },
  { type: "action_item", body: `${TAG} URGENT middle`,    priority: "urgent",     completed_at: null, deleted_at: null, created_offset_seconds: 5 },
  { type: "action_item", body: `${TAG} URGENT oldest`,    priority: "urgent",     completed_at: null, deleted_at: null, created_offset_seconds: 4 },
  { type: "action_item", body: `${TAG} THIS_WEEK newer`,  priority: "this_week",  completed_at: null, deleted_at: null, created_offset_seconds: 7 },
  { type: "action_item", body: `${TAG} THIS_WEEK older`,  priority: "this_week",  completed_at: null, deleted_at: null, created_offset_seconds: 3 },
  { type: "action_item", body: `${TAG} WHEN_READY only`,  priority: "when_ready", completed_at: null, deleted_at: null, created_offset_seconds: 2 },
  { type: "action_item", body: `${TAG} COMPLETED urgent`, priority: "urgent",     completed_at: new Date().toISOString(), deleted_at: null, created_offset_seconds: 8 },
  { type: "action_item", body: `${TAG} DELETED urgent`,   priority: "urgent",     completed_at: null, deleted_at: new Date().toISOString(), created_offset_seconds: 9 },
  { type: "session_recap", body: `${TAG} session recap`,  priority: null,         completed_at: null, deleted_at: null, created_offset_seconds: 10 },
  { type: "other",        body: `${TAG} other note`,      priority: null,         completed_at: null, deleted_at: null, created_offset_seconds: 11 },
]

const EXPECTED_BODIES_IN_ORDER = [
  // Urgent bucket, newest first within bucket
  `${TAG} URGENT newest`,
  `${TAG} URGENT middle`,
  `${TAG} URGENT oldest`,
  // This week bucket, newest first within bucket
  `${TAG} THIS_WEEK newer`,
  `${TAG} THIS_WEEK older`,
  // When ready bucket
  `${TAG} WHEN_READY only`,
]

const EXCLUDED_MARKERS = ["COMPLETED urgent", "DELETED urgent", "session recap", "other note"]

let seededIds: string[] = []
let pass = true

async function lookupCoachClient() {
  const { data: coach, error: ce } = await sb
    .from("client_profiles")
    .select("id, email, name")
    .eq("email", COACH_EMAIL)
    .maybeSingle()
  if (ce || !coach) abort(`Coach not found by email: ${COACH_EMAIL}`)

  const { data: client, error: cle } = await sb
    .from("client_profiles")
    .select("id, email, name")
    .eq("email", CLIENT_EMAIL)
    .maybeSingle()
  if (cle || !client) abort(`Client not found by email: ${CLIENT_EMAIL}`)

  const { data: link, error: le } = await sb
    .from("coach_clients")
    .select("id, status, access_level")
    .eq("coach_profile_id", coach.id)
    .eq("client_profile_id", client.id)
    .eq("status", "active")
    .maybeSingle()
  if (le || !link) abort(`No active coach_clients link between ${COACH_EMAIL} and ${CLIENT_EMAIL}`)

  return { coach, client, link }
}

async function seedFixtures(coachId: string, clientId: string, coachClientId: string) {
  const baseTime = Date.now()
  for (const f of FIXTURES) {
    // Create newer items at later (more recent) timestamps so created_at
    // ordering reflects the offset.
    const createdAt = new Date(baseTime - (12 - f.created_offset_seconds) * 1000).toISOString()
    const { data, error } = await sb
      .from("coach_client_notes")
      .insert({
        coach_client_id: coachClientId,
        coach_profile_id: coachId,
        client_profile_id: clientId,
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
      console.error(`✗ seed failed for ${f.body}: ${error?.message}`)
      pass = false
      return
    }
    seededIds.push(data.id)
  }
  console.log(`✓ Seeded ${seededIds.length} fixture rows`)
}

async function runQuery(coachId: string, clientId: string) {
  // Mirrors the route exactly.
  const { data, error } = await sb
    .from("coach_client_notes")
    .select("id, body, priority, created_at, completed_at")
    .eq("coach_profile_id", coachId)
    .eq("client_profile_id", clientId)
    .eq("type", "action_item")
    .is("deleted_at", null)
    .is("completed_at", null)
  if (error) {
    console.error(`✗ query failed: ${error.message}`)
    pass = false
    return []
  }

  const items = (data ?? [])
    .map((r) => ({
      note_id: r.id as string,
      body: r.body as string,
      priority: r.priority as string,
      created_at: r.created_at as string,
      completed_at: r.completed_at as string | null,
    }))
    .sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99
      const pb = PRIORITY_ORDER[b.priority] ?? 99
      if (pa !== pb) return pa - pb
      return b.created_at.localeCompare(a.created_at)
    })

  return items
}

function assertSortAndExclusions(items: { note_id: string; body: string; priority: string; created_at: string; completed_at: string | null }[]) {
  // Filter to only this verification's tagged rows (other action items
  // for this fixture client may exist).
  const ours = items.filter((i) => i.body.includes(TAG))

  // Exclusion checks
  for (const marker of EXCLUDED_MARKERS) {
    const found = ours.find((i) => i.body.includes(marker))
    if (found) {
      console.error(`✗ EXCLUDED-but-present: ${marker} (note_id ${found.note_id})`)
      pass = false
    } else {
      console.log(`✓ excluded: ${marker}`)
    }
  }

  // Length check
  if (ours.length !== EXPECTED_BODIES_IN_ORDER.length) {
    console.error(`✗ expected ${EXPECTED_BODIES_IN_ORDER.length} items, got ${ours.length}`)
    pass = false
  }

  // Sort order check
  for (let i = 0; i < EXPECTED_BODIES_IN_ORDER.length; i++) {
    const expected = EXPECTED_BODIES_IN_ORDER[i]
    const actual = ours[i]?.body
    if (actual !== expected) {
      console.error(`✗ position ${i}: expected "${expected}", got "${actual}"`)
      pass = false
    } else {
      console.log(`✓ position ${i}: ${expected} (${ours[i].priority})`)
    }
  }

  // Shape check on first item
  if (ours[0]) {
    const sample = ours[0]
    const requiredKeys = ["note_id", "body", "priority", "created_at", "completed_at"]
    for (const k of requiredKeys) {
      if (!(k in sample)) {
        console.error(`✗ response shape missing key: ${k}`)
        pass = false
      }
    }
    if (sample.completed_at !== null) {
      console.error(`✗ open item should have completed_at=null, got ${sample.completed_at}`)
      pass = false
    }
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
  console.log("│ Phase 2 — Per-client Needs Attention verification            │")
  console.log("└──────────────────────────────────────────────────────────────┘")
  console.log(`Target: ${SUPABASE_URL}`)
  console.log(`Coach:  ${COACH_EMAIL}`)
  console.log(`Client: ${CLIENT_EMAIL}\n`)

  const { coach, client, link } = await lookupCoachClient()
  console.log(`✓ coach=${coach.id} client=${client.id} link=${link.id}\n`)

  console.log("--- SEEDING ---")
  await seedFixtures(coach.id, client.id, link.id)

  console.log("\n--- QUERY + SORT ---")
  const items = await runQuery(coach.id, client.id)
  console.log(`Returned ${items.length} item(s) total (including any pre-existing for this coach/client pair)`)

  console.log("\n--- ASSERTIONS ---")
  assertSortAndExclusions(items)

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
