#!/usr/bin/env tsx
// Package seed: load docs/WRN_SIGNAL_Package_Seed.xlsx (as tests/package-seed/seed.ts)
// into one coach's library: 13 deliverables with phase and fee, their 54 tasks,
// and 8 packages (The Proof Project is parked) with the discount that brings
// each package's fee total to its sheet price.
//
// Runs after tests/package-seed/wipe.sql, so it refuses a coach whose library
// is not empty (a second run cannot duplicate). Dry run unless --apply. On a
// failed --apply it deletes what it created, so a run lands whole or not at all.
//
// USAGE:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... COACH_EMAIL=peri+democoach@workforcereadynow.com \
//   NODE_OPTIONS=--use-system-ca npx tsx tests/package-seed/import-packages.ts [--apply]
// Against prod, also set ALLOW_PROD=yes.
//
// Creds come from process.env only; this file never reads .env*.

import { createClient } from "@supabase/supabase-js"
import { SEED_DELIVERABLES, SEED_PACKAGES, normName } from "./seed"

const PROD_REF = "ejhnokcnahauvrcbcmic" // DEVELOPMENT.md, "The mental model"

// Approved 2026-10-04. Each a la carte package's deliverables sum to its price.
const FEES: Record<string, number> = {
  "Your SIGNAL DNA Assessment": 100,
  "Your SIGNAL DNA Report": 150,
  "Your SIGNAL DNA Decode and Career Path Session": 100,
  "Resume Workshop": 100,
  "Resume": 150,
  "Cover Letter": 125,
  "LinkedIn Rebuild": 125,
  "SIGNAL Setup and Job Search Strategy": 400,
  "Networking Campaign": 800,
  "Interview Sessions 1 to 3": 900,
  "Mock Interview": 300,
  "Pre-Interview Prep": 150,
  "Offboarding": 150,
}

function req(name: string, alt?: string): string {
  const v = process.env[name] || (alt ? process.env[alt] : undefined)
  if (!v) { console.error(`Missing ${name}`); process.exit(2) }
  return v
}

const url = req("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
const ref = new URL(url).hostname.split(".")[0]
const apply = process.argv.includes("--apply")
const email = req("COACH_EMAIL").trim().toLowerCase()
if (ref === PROD_REF && process.env.ALLOW_PROD !== "yes") {
  console.error("This is PROD. Set ALLOW_PROD=yes to run against it.")
  process.exit(2)
}
const db = createClient(url, req("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } })

function must<T>(label: string, r: { data: T | null; error: any }): T {
  if (r.error) throw new Error(`${label}: ${r.error.message}`)
  return r.data as T
}

// The package total as SIGNAL shows it (app/api/_lib/coachPackages.ts).
function total(deliverables: string[], discount: number | null) {
  const subtotal = deliverables.reduce((s, n) => s + FEES[n], 0)
  return { subtotal, total: subtotal - Math.min(discount ?? 0, subtotal) }
}

async function main() {
  console.log(`Project: ${ref}${ref === PROD_REF ? " (PROD)" : ""}   Mode: ${apply ? "APPLY" : "dry run"}`)

  // ── Checks: sheet data, coach, phases, empty library ──
  for (const d of SEED_DELIVERABLES) if (!(d.name in FEES)) throw new Error(`no fee for ${d.name}`)
  for (const p of SEED_PACKAGES)
    for (const n of p.deliverables)
      if (!SEED_DELIVERABLES.some((d) => d.name === n)) throw new Error(`${p.name}: unknown deliverable ${n}`)

  const profiles = must("client_profiles", await db.from("client_profiles")
    .select("id, email, is_coach").ilike("email", `%${email}%`)) as any[]
  const coach = profiles.filter((p) => p.email.trim().toLowerCase() === email)
  if (coach.length !== 1) throw new Error(`expected one profile for ${email}, found ${coach.length}`)
  if (!coach[0].is_coach) throw new Error(`${email} is not a coach`)
  const coachId: string = coach[0].id
  console.log(`Coach: ${email}  ${coachId}`)

  const phases = must("coach_phases (migration 20261004 applied?)", await db.from("coach_phases")
    .select("id, phase_key, label, active").eq("coach_profile_id", coachId)) as any[]
  const phaseId = new Map<string, string>()
  for (const label of new Set(SEED_DELIVERABLES.map((d) => d.phase))) {
    const ph = phases.find((p) => p.phase_key === label.toLowerCase())
    if (!ph) throw new Error(`coach has no ${label} phase`)
    if (!ph.active) console.log(`  note: phase ${ph.label} is switched off for this coach`)
    phaseId.set(label, ph.id)
  }

  const [pk, ms] = await Promise.all([
    db.from("coach_packages").select("id", { count: "exact", head: true }).eq("coach_profile_id", coachId),
    db.from("coach_milestones").select("id", { count: "exact", head: true }).eq("coach_profile_id", coachId),
  ])
  if (pk.error || ms.error) throw new Error((pk.error ?? ms.error)!.message)
  if ((pk.count ?? 0) + (ms.count ?? 0) > 0)
    throw new Error(`library not empty (${pk.count} packages, ${ms.count} deliverables): run wipe.sql first`)

  // ── The plan ──
  console.log(`\nDeliverables (${SEED_DELIVERABLES.length}), tasks (${SEED_DELIVERABLES.reduce((n, d) => n + d.tasks.length, 0)}):`)
  SEED_DELIVERABLES.forEach((d, i) => {
    console.log(`  ${i + 1}. [${d.phase}] ${d.name}  $${FEES[d.name]}`)
    for (const t of d.tasks) console.log(`       ${t.order}. (${t.type}) ${t.name}`)
  })
  const pkgPlan = SEED_PACKAGES.map((p) => {
    const subtotal = p.deliverables.reduce((s, n) => s + FEES[n], 0)
    const discount = subtotal - p.price
    if (discount < 0) throw new Error(`${p.name}: fees sum to $${subtotal}, below its $${p.price} price`)
    return { ...p, discount: discount === 0 ? null : discount }
  })
  console.log(`\nPackages (${pkgPlan.length}):`)
  pkgPlan.forEach((p, i) => console.log(
    `  ${i + 1}. ${p.name}  price $${p.price}  (fees $${total(p.deliverables, null).subtotal}` +
    `${p.discount ? `, discount $${p.discount}` : ", no discount"})  ${p.deliverables.length} deliverables`))

  if (!apply) { console.log("\nDry run: nothing written. Re-run with --apply."); return }

  // ── Write ──
  const createdPkgs: string[] = []
  const createdDelivs: string[] = []
  try {
    const delivId = new Map<string, string>()
    for (const [i, d] of SEED_DELIVERABLES.entries()) {
      const row = must(`insert ${d.name}`, await db.from("coach_milestones").insert({
        coach_profile_id: coachId, name: d.name, phase_id: phaseId.get(d.phase),
        fee_cents: FEES[d.name] * 100, sort_order: i + 1, active: true,
      }).select("id").single()) as any
      createdDelivs.push(row.id)
      delivId.set(d.name, row.id)
      must(`tasks for ${d.name}`, await db.from("coach_milestone_activities").insert(
        d.tasks.map((t) => ({ milestone_id: row.id, name: t.name, owner: t.type, sort_order: t.order }))))
    }
    for (const [i, p] of pkgPlan.entries()) {
      const row = must(`insert ${p.name}`, await db.from("coach_packages").insert({
        coach_profile_id: coachId, name: p.name, sort_order: i + 1, active: true,
        discount_cents: p.discount === null ? null : p.discount * 100,
      }).select("id").single()) as any
      createdPkgs.push(row.id)
      must(`links for ${p.name}`, await db.from("coach_package_milestones").insert(
        p.deliverables.map((n, j) => ({ package_id: row.id, milestone_id: delivId.get(n), sort_order: j + 1 }))))
    }
  } catch (e) {
    console.error(`\nFAILED: ${(e as Error).message}\nRemoving what this run created...`)
    if (createdPkgs.length) await db.from("coach_packages").delete().in("id", createdPkgs)
    if (createdDelivs.length) await db.from("coach_milestones").delete().in("id", createdDelivs)
    throw e
  }

  // ── Verify by reading back ──
  const delivs = must("read deliverables", await db.from("coach_milestones")
    .select("id, name, fee_cents").eq("coach_profile_id", coachId)) as any[]
  const acts = must("read tasks", await db.from("coach_milestone_activities")
    .select("id").in("milestone_id", delivs.map((d) => d.id))) as any[]
  const pkgs = must("read packages", await db.from("coach_packages")
    .select("id, name, discount_cents").eq("coach_profile_id", coachId)) as any[]
  const links = must("read links", await db.from("coach_package_milestones")
    .select("package_id, milestone_id").in("package_id", pkgs.map((p) => p.id))) as any[]
  const fee = new Map(delivs.map((d) => [d.id, d.fee_cents as number]))
  let bad = 0
  console.log(`\nRead back: ${delivs.length} deliverables, ${acts.length} tasks, ${pkgs.length} packages, ${links.length} links`)
  for (const p of pkgs) {
    const sub = links.filter((l) => l.package_id === p.id).reduce((s, l) => s + (fee.get(l.milestone_id) ?? 0), 0)
    const shown = (sub - Math.min(p.discount_cents ?? 0, sub)) / 100
    const want = SEED_PACKAGES.find((s) => normName(s.name) === normName(p.name))?.price
    const okRow = shown === want
    if (!okRow) bad++
    console.log(`  ${okRow ? "ok  " : "FAIL"} ${p.name}: SIGNAL total $${shown}, sheet $${want}`)
  }
  const expectTasks = SEED_DELIVERABLES.reduce((n, d) => n + d.tasks.length, 0)
  if (delivs.length !== SEED_DELIVERABLES.length || acts.length !== expectTasks || pkgs.length !== SEED_PACKAGES.length) bad++
  if (bad) throw new Error("read-back does not match the sheet")
  console.log("\nImport complete and verified.")
}

main().catch((e) => { console.error((e as Error).message ?? e); process.exit(1) })
