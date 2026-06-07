#!/usr/bin/env -S npx tsx
// Verification for the coached-account gate (app/api/_lib/coachedClient.ts).
//
// The gate is a server-side function, not an HTTP endpoint, so this imports it
// directly and runs it against throwaway coach_clients fixtures in the DEV DB:
//   active  → getActiveCoachRelationship returns the row; isCoached true
//   paused / revoked / pending → null; isCoached false
//   no row at all → null; isCoached false
//
// SAFETY: dev-ref guard (aborts on prod). Fixtures use clean client_profiles
// (no existing coach_clients row) so the gate result is deterministic, and are
// cleaned up by the marker name at start + end.
//
// USAGE:
//   SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//   npx tsx scripts/verify-coached-gate.ts

import { createClient } from "@supabase/supabase-js"
import { getActiveCoachRelationship, isCoached } from "../app/api/_lib/coachedClient"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const PROD_REF = "ejhnokcnahauvrcbcmic"
const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const MARKER = "__verify_gate_throwaway__"
const TAG = "[verify-coached-gate]"

function abort(msg: string): never { console.error(`✗ ${msg}`); process.exit(1) }
if (!SUPABASE_URL) abort("SUPABASE_URL is required")
if (SUPABASE_URL.includes(PROD_REF)) abort(`REFUSED: SUPABASE_URL contains the PROD ref (${PROD_REF}). Dev only.`)
if (!SUPABASE_URL.includes(DEV_REF)) abort(`REFUSED: SUPABASE_URL must contain dev ref (${DEV_REF}).`)
if (!SUPABASE_SERVICE_ROLE_KEY) abort("SUPABASE_SERVICE_ROLE_KEY is required")

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let pass = true
const check = (name: string, cond: boolean, detail?: string) => {
  if (cond) console.log(`  ✓ ${name}`)
  else { pass = false; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`) }
}

async function clearMarker() {
  await sb.from("coach_clients").delete().eq("name", MARKER)
}
// client_profiles ids with NO coach_clients row at all → deterministic gate.
async function pickCleanClients(n: number, excludeCoachId: string): Promise<string[]> {
  const { data: profs } = await sb.from("client_profiles").select("id").limit(2000)
  const { data: links } = await sb.from("coach_clients").select("client_profile_id")
  const taken = new Set((links || []).map((l: any) => l.client_profile_id).filter(Boolean))
  const free = (profs || []).map((p: any) => p.id).filter((id: string) => !taken.has(id) && id !== excludeCoachId)
  if (free.length < n) abort(`not enough clean client_profiles (need ${n}, have ${free.length})`)
  return free.slice(0, n)
}
async function createRel(coachId: string, clientId: string, status: string) {
  const { error } = await sb.from("coach_clients").insert({
    coach_profile_id: coachId,
    client_profile_id: clientId,
    status,
    access_level: "full",
    lifecycle_status: "Active",
    name: MARKER,
  })
  if (error) abort(`createRel(${status}) failed: ${error.message}`)
}

async function main() {
  console.log(`${TAG} dev=${SUPABASE_URL}`)
  await clearMarker()

  // A coach to own the throwaway rows.
  const { data: coach } = await sb.from("client_profiles").select("id").eq("is_coach", true).limit(1).maybeSingle()
  if (!coach?.id) abort("no is_coach=true profile found to own throwaway relationships")
  const coachId = coach.id as string

  // 5 clean clients: active / paused / revoked / pending / no-row.
  const [cActive, cPaused, cRevoked, cPending, cNoRow] = await pickCleanClients(5, coachId)
  await createRel(coachId, cActive, "active")
  await createRel(coachId, cPaused, "paused")
  await createRel(coachId, cRevoked, "revoked")
  await createRel(coachId, cPending, "pending")
  // cNoRow: deliberately no coach_clients row.

  console.log("\nGate: getActiveCoachRelationship / isCoached")
  const relActive = await getActiveCoachRelationship(sb, cActive)
  check("active → relationship returned", relActive !== null, JSON.stringify(relActive))
  check("active → status active + coach matches", relActive?.status === "active" && relActive?.coach_profile_id === coachId)
  check("active → isCoached true", (await isCoached(sb, cActive)) === true)

  check("paused → null", (await getActiveCoachRelationship(sb, cPaused)) === null)
  check("paused → isCoached false", (await isCoached(sb, cPaused)) === false)
  check("revoked → null", (await getActiveCoachRelationship(sb, cRevoked)) === null)
  check("revoked → isCoached false", (await isCoached(sb, cRevoked)) === false)
  check("pending → null", (await getActiveCoachRelationship(sb, cPending)) === null)
  check("pending → isCoached false", (await isCoached(sb, cPending)) === false)
  check("no row → null", (await getActiveCoachRelationship(sb, cNoRow)) === null)
  check("no row → isCoached false", (await isCoached(sb, cNoRow)) === false)

  await clearMarker()
  console.log("\ncleanup: throwaway coach_clients rows cleared")
  console.log(`\n${pass ? "✓ ALL PASS" : "✗ FAILURES ABOVE"}`)
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
