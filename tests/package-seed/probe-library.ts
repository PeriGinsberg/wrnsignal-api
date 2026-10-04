#!/usr/bin/env tsx
// Package seed, step 0: what a coach's library holds before the import.
// READ-ONLY. Lists the coach's phases, library deliverables (with their tasks)
// and packages (with their deliverables and how many clients use each), and
// names which deliverables and packages in docs/WRN_SIGNAL_Package_Seed.xlsx
// already exist by name.
//
// USAGE (works on dev or prod; it never writes):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... COACH_EMAIL=peri+democoach@workforcereadynow.com \
//   NODE_OPTIONS=--use-system-ca npx tsx tests/package-seed/probe-library.ts
//
// Creds come from process.env only; this file never reads .env*.

import { createClient } from "@supabase/supabase-js"
import { SEED_DELIVERABLES, SEED_PACKAGES, normName } from "./seed"

function req(name: string, alt?: string): string {
  const v = process.env[name] || (alt ? process.env[alt] : undefined)
  if (!v) { console.error(`Missing ${name}`); process.exit(2) }
  return v
}

const url = req("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
const db = createClient(url, req("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } })
const email = req("COACH_EMAIL").trim().toLowerCase()

function must<T>(label: string, r: { data: T | null; error: any }): T {
  if (r.error) throw new Error(`${label}: ${r.error.message}`)
  return r.data as T
}

async function main() {
  console.log(`Project: ${new URL(url).hostname.split(".")[0]}`)

  const profiles = must("client_profiles", await db.from("client_profiles")
    .select("id, email, is_coach, user_id").ilike("email", `%${email}%`))
  const coaches = (profiles as any[]).filter((p) => p.email.trim().toLowerCase() === email)
  console.log(`Coach rows for ${email}: ${coaches.length}`)
  for (const p of coaches) console.log(`  ${p.id}  is_coach=${p.is_coach}  user_id=${p.user_id ?? "null"}`)
  if (coaches.length !== 1) throw new Error("expected exactly one profile row")
  const coachId = coaches[0].id

  const phases = await db.from("coach_phases").select("id, phase_key, label, sort_order, active")
    .eq("coach_profile_id", coachId).order("sort_order")
  if (phases.error) console.log(`\nPhases: unavailable (${phases.error.message})`)
  else {
    console.log(`\nPhases (${phases.data.length}):`)
    for (const p of phases.data) console.log(`  ${p.sort_order}. ${p.label} [${p.phase_key}]${p.active ? "" : " (off)"}`)
  }
  const phaseLabel = new Map((phases.data ?? []).map((p: any) => [p.id, p.label]))

  const delivs = must("coach_milestones", await db.from("coach_milestones")
    .select("*").eq("coach_profile_id", coachId).order("sort_order")) as any[]
  const acts = delivs.length
    ? must("coach_milestone_activities", await db.from("coach_milestone_activities")
        .select("milestone_id, name, owner, sort_order").in("milestone_id", delivs.map((d) => d.id))
        .order("sort_order")) as any[]
    : []
  console.log(`\nLibrary deliverables (${delivs.length}):`)
  for (const d of delivs) {
    const fee = d.fee_cents == null ? "no fee" : `$${d.fee_cents / 100}`
    const phase = d.phase_id ? phaseLabel.get(d.phase_id) ?? "?" : "no phase"
    console.log(`  ${d.sort_order}. ${d.name}  [${phase}, ${fee}, category=${d.category ?? "-"}${d.active ? "" : ", inactive"}]  ${d.id}`)
    for (const a of acts.filter((a) => a.milestone_id === d.id)) console.log(`       ${a.sort_order}. (${a.owner}) ${a.name}`)
  }

  const pkgs = must("coach_packages", await db.from("coach_packages")
    .select("*").eq("coach_profile_id", coachId).order("sort_order")) as any[]
  const links = pkgs.length
    ? must("coach_package_milestones", await db.from("coach_package_milestones")
        .select("package_id, milestone_id, sort_order").in("package_id", pkgs.map((p) => p.id))
        .order("sort_order")) as any[]
    : []
  const engs = pkgs.length
    ? must("coach_client_engagements", await db.from("coach_client_engagements")
        .select("source_package_id").in("source_package_id", pkgs.map((p) => p.id))) as any[]
    : []
  const delivName = new Map(delivs.map((d) => [d.id, d.name]))
  console.log(`\nPackages (${pkgs.length}):`)
  for (const p of pkgs) {
    const used = engs.filter((e) => e.source_package_id === p.id).length
    const disc = p.discount_cents == null ? "no discount" : `discount $${p.discount_cents / 100}`
    console.log(`  ${p.sort_order}. ${p.name}  [${disc}${p.active ? "" : ", inactive"}, attached to ${used} client engagement(s)]  ${p.id}`)
    for (const l of links.filter((l) => l.package_id === p.id)) console.log(`       - ${delivName.get(l.milestone_id) ?? l.milestone_id}`)
  }

  console.log(`\nSeed deliverables already in the library (by name):`)
  const byName = new Map(delivs.map((d) => [normName(d.name), d]))
  for (const s of SEED_DELIVERABLES) {
    const hit = byName.get(normName(s.name))
    console.log(`  ${hit ? "MATCH " : "new   "} ${s.name}${hit ? `  -> ${hit.id} (${acts.filter((a) => a.milestone_id === hit.id).length} tasks)` : ""}`)
  }
  console.log(`\nSeed packages already present (by name):`)
  const pkgByName = new Map(pkgs.map((p) => [normName(p.name), p]))
  for (const s of SEED_PACKAGES) {
    const hit = pkgByName.get(normName(s.name))
    console.log(`  ${hit ? "EXISTS" : "new   "} ${s.name}${hit ? `  -> ${hit.id}` : ""}`)
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
