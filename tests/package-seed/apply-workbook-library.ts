#!/usr/bin/env tsx
// The library changes in docs/WRN Coaching Workflow Workbook.md, for one coach.
//
// IN THE LIBRARY
//   1. "Your SIGNAL DNA Decode and Career Path Session" is renamed
//      "Career Planning Decoded" and moves to the Build phase.
//   2. Its steps: "Book Decode session" -> "Book Career Planning Decoded session",
//      "Prepare for Decode session" -> "Prepare for Career Planning Decoded",
//      "Run Decode session" -> "Run Career Planning Decoded".
//   3. "Book Job Search Strategy/Networking session" -> "Book Job Search Strategy Session".
//   4. "Book Review Networking Plan session" -> "Book Review Networking Plan session (optional)".
//   5. In Know Where to Aim, Run the Search and All the Way Through, Career
//      Planning Decoded moves to right after Resume Workshop.
//
// ON CLIENTS' PLANS (agreed 2026-10-16): the renames only. Deliverables and
// steps keep their order and phase. An open To-Do item for a renamed step is
// retitled.
//
// Renames go by the old name, so a second run finds nothing to do. Dry run
// unless --apply.
//
// USAGE:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... COACH_EMAIL=peri@workforcereadynow.com \
//   NODE_OPTIONS=--use-system-ca npx tsx tests/package-seed/apply-workbook-library.ts [--apply]
// Against prod, also set ALLOW_PROD=yes.
//
// Creds come from process.env only; this file never reads .env*.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { syncTodo } from "../../lib/plan/todo"

const PROD_REF = "ejhnokcnahauvrcbcmic" // DEVELOPMENT.md, "The mental model"

export const OLD_DECODE = "Your SIGNAL DNA Decode and Career Path Session"
export const NEW_DECODE = "Career Planning Decoded"
export const STEP_RENAMES: [string, string][] = [
  ["Book Decode session", "Book Career Planning Decoded session"],
  ["Prepare for Decode session", "Prepare for Career Planning Decoded"],
  ["Run Decode session", "Run Career Planning Decoded"],
  ["Book Job Search Strategy/Networking session", "Book Job Search Strategy Session"],
  ["Book Review Networking Plan session", "Book Review Networking Plan session (optional)"],
]
export const REORDER_PACKAGES = ["Know Where to Aim", "Run the Search", "All the Way Through"]
const AFTER = "Resume Workshop"

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase()

function must<T>(label: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`${label}: ${r.error.message}`)
  return r.data as T
}

export type Change = { what: string; table: string; id: string; patch: Record<string, unknown> }

/** Every change this coach needs, worked out without writing anything. */
export async function planWorkbookLibrary(db: SupabaseClient, coachId: string): Promise<{ changes: Change[]; todoIds: string[]; warnings: string[] }> {
  const changes: Change[] = []
  const warnings: string[] = []

  // ── The library ──
  const milestones = must("coach_milestones", await db.from("coach_milestones").select("id, name, phase_id").eq("coach_profile_id", coachId)) as
    { id: string; name: string; phase_id: string | null }[]
  const phases = must("coach_phases", await db.from("coach_phases").select("id, phase_key").eq("coach_profile_id", coachId)) as { id: string; phase_key: string }[]
  const build = phases.find((p) => p.phase_key === "build")
  const decode = milestones.find((m) => norm(m.name) === norm(OLD_DECODE)) ?? milestones.find((m) => norm(m.name) === norm(NEW_DECODE))
  if (!decode) warnings.push(`No "${OLD_DECODE}" or "${NEW_DECODE}" deliverable in the library.`)
  else {
    const patch: Record<string, unknown> = {}
    if (norm(decode.name) !== norm(NEW_DECODE)) patch.name = NEW_DECODE
    if (!build) warnings.push("This coach has no Build phase, so Career Planning Decoded keeps its phase.")
    else if (decode.phase_id !== build.id) patch.phase_id = build.id
    if (Object.keys(patch).length) changes.push({ what: `library deliverable "${decode.name}"`, table: "coach_milestones", id: decode.id, patch })
  }

  const milestoneIds = milestones.map((m) => m.id)
  const libSteps = milestoneIds.length
    ? must("coach_milestone_activities", await db.from("coach_milestone_activities").select("id, name, milestone_id").in("milestone_id", milestoneIds)) as
      { id: string; name: string; milestone_id: string }[]
    : []
  for (const [from, to] of STEP_RENAMES) {
    for (const s of libSteps.filter((x) => norm(x.name) === norm(from))) {
      changes.push({ what: `library step "${s.name}" -> "${to}"`, table: "coach_milestone_activities", id: s.id, patch: { name: to } })
    }
  }

  // ── Package order ──
  const packages = must("coach_packages", await db.from("coach_packages").select("id, name").eq("coach_profile_id", coachId)) as { id: string; name: string }[]
  const workshop = milestones.find((m) => norm(m.name) === norm(AFTER))
  for (const name of REORDER_PACKAGES) {
    const pkg = packages.find((p) => norm(p.name) === norm(name))
    if (!pkg) { warnings.push(`No "${name}" package.`); continue }
    if (!decode || !workshop) continue
    const links = (must(`links for ${name}`, await db.from("coach_package_milestones").select("id, milestone_id, sort_order").eq("package_id", pkg.id)) as
      { id: string; milestone_id: string; sort_order: number }[]).sort((a, b) => a.sort_order - b.sort_order)
    const d = links.find((l) => l.milestone_id === decode.id)
    if (!d || !links.some((l) => l.milestone_id === workshop.id)) { warnings.push(`"${name}" lacks Career Planning Decoded or Resume Workshop; order left alone.`); continue }
    const rest = links.filter((l) => l !== d)
    rest.splice(rest.findIndex((l) => l.milestone_id === workshop.id) + 1, 0, d)
    rest.forEach((l, i) => {
      if (l.sort_order !== i) changes.push({ what: `"${name}" position ${i}`, table: "coach_package_milestones", id: l.id, patch: { sort_order: i } })
    })
  }

  // ── Clients' plans: names only ──
  const clients = must("coach_clients", await db.from("coach_clients").select("id").eq("coach_profile_id", coachId)) as { id: string }[]
  const todoIds: string[] = []
  if (clients.length) {
    const engs = must("coach_client_engagements", await db.from("coach_client_engagements").select("id").in("coach_client_id", clients.map((c) => c.id))) as { id: string }[]
    const delivs = engs.length
      ? must("deliverables", await db.from("coach_client_engagement_deliverables").select("id, name").in("engagement_id", engs.map((e) => e.id))) as { id: string; name: string }[]
      : []
    for (const d of delivs.filter((x) => norm(x.name) === norm(OLD_DECODE))) {
      changes.push({ what: `plan deliverable ${d.id}`, table: "coach_client_engagement_deliverables", id: d.id, patch: { name: NEW_DECODE } })
    }
    const steps = delivs.length
      ? must("steps", await db.from("coach_client_engagement_activities").select("id, name, state").in("engagement_deliverable_id", delivs.map((d) => d.id))) as
        { id: string; name: string; state: string }[]
      : []
    for (const [from, to] of STEP_RENAMES) {
      for (const s of steps.filter((x) => norm(x.name) === norm(from))) {
        changes.push({ what: `plan step "${s.name}" (${s.state}) -> "${to}"`, table: "coach_client_engagement_activities", id: s.id, patch: { name: to } })
        todoIds.push(s.id)
      }
    }
  }
  return { changes, todoIds, warnings }
}

/** Write the changes, then retitle the renamed steps' open To-Do items. */
export async function applyWorkbookLibrary(db: SupabaseClient, plan: { changes: Change[]; todoIds: string[] }): Promise<void> {
  for (const c of plan.changes) {
    const { error } = await db.from(c.table).update(c.patch).eq("id", c.id)
    if (error) throw new Error(`${c.what}: ${error.message}`)
  }
  for (const id of plan.todoIds) await syncTodo(db, id)
}

function req(name: string, alt?: string): string {
  const v = process.env[name] || (alt ? process.env[alt] : undefined)
  if (!v) { console.error(`Missing ${name}`); process.exit(2) }
  return v
}

async function main() {
  const url = req("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
  const ref = new URL(url).hostname.split(".")[0]
  const apply = process.argv.includes("--apply")
  const email = req("COACH_EMAIL").trim().toLowerCase()
  if (ref === PROD_REF && process.env.ALLOW_PROD !== "yes") {
    console.error("This is PROD. Set ALLOW_PROD=yes to run against it.")
    process.exit(2)
  }
  const db = createClient(url, req("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } })
  console.log(`Project: ${ref}${ref === PROD_REF ? " (PROD)" : ""}   Mode: ${apply ? "APPLY" : "dry run"}`)

  const { data: profiles, error } = await db.from("client_profiles").select("id, email, is_coach").ilike("email", `%${email}%`)
  if (error) throw new Error(`client_profiles: ${error.message}`)
  const coach = ((profiles ?? []) as { id: string; email: string; is_coach: boolean }[]).filter((p) => p.email.trim().toLowerCase() === email)
  if (coach.length !== 1 || !coach[0].is_coach) throw new Error(`expected one coach profile for ${email}, found ${coach.length}`)
  console.log(`Coach: ${email}  ${coach[0].id}\n`)

  const plan = await planWorkbookLibrary(db, coach[0].id)
  for (const w of plan.warnings) console.log(`  WARN  ${w}`)
  for (const c of plan.changes) console.log(`  ${c.table.padEnd(38)} ${c.what}  ${JSON.stringify(c.patch)}`)
  console.log(`\n${plan.changes.length} change(s); ${plan.todoIds.length} plan step(s) whose open To-Do item is retitled.`)
  if (!plan.changes.length) { console.log("Nothing to do."); return }
  if (!apply) { console.log("Dry run: nothing written. Re-run with --apply."); return }
  await applyWorkbookLibrary(db, plan)
  const again = await planWorkbookLibrary(db, coach[0].id)
  if (again.changes.length) throw new Error(`After applying, ${again.changes.length} change(s) still show; check the rows above.`)
  console.log("Applied and verified: a second pass finds nothing to do.")
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("tests/package-seed/apply-workbook-library.ts")) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
}
