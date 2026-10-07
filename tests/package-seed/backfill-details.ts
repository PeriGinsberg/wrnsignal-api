#!/usr/bin/env tsx
// Task details backfill: the "Details / checklist" column of
// docs/WRN_SIGNAL_Package_Seed.xlsx into one coach's library tasks, then into
// existing client plan tasks copied from those library tasks.
//
// FILLS ONLY WHAT IS EMPTY. A library task or plan task that already has
// details keeps them. A plan task gets its library task's details (the sheet's
// text, or the coach's own if the library task already had some).
//
// MATCHING. A sheet row is matched to the coach's library task by deliverable
// name and task name, ignoring case. A task renamed in the library ("Run and
// record mock interview" for "Run Mock Interview") is matched by deliverable
// and order number instead, and listed separately so it can be checked. A row
// that matches neither is listed and skipped, never guessed.
//
// Dry run unless --yes. Credentials come from the environment; this file never
// reads a .env file.
//
// USAGE (dev):
//   node --use-system-ca --env-file=.env.local --env-file=.env.development.local \
//     node_modules/tsx/dist/cli.mjs tests/package-seed/backfill-details.ts --coach=peri+democoach@workforcereadynow.com [--yes]
// USAGE (prod, in your own PowerShell window so keys stay out of transcripts):
//   $env:SUPABASE_URL="..."; $env:SUPABASE_SERVICE_ROLE_KEY="..."
//   node --use-system-ca node_modules/tsx/dist/cli.mjs tests/package-seed/backfill-details.ts --coach=peri@workforcereadynow.com [--yes]

import { createClient } from "@supabase/supabase-js"
import { readSheet } from "read-excel-file/node"
import { normalizeDetails } from "../../lib/plan/model"

const FILE = "docs/WRN_SIGNAL_Package_Seed.xlsx"
const SHEET = "Deliverables and Tasks"
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ")

function need(name: string): string {
  const v = process.env[name]
  if (!v) { console.error(`${name} is not set.`); process.exit(1) }
  return v
}

type SheetRow = { deliverable: string; order: number; task: string; details: string }
type LibTask = { id: string; milestone_id: string; name: string; sort_order: number; details: string | null }

async function sheetRows(): Promise<SheetRow[]> {
  const rows = (await (readSheet as any)(FILE, SHEET)) as unknown[][]
  const h = rows.findIndex((r) => r.some((c) => norm(c) === "task") && r.some((c) => norm(c).startsWith("details")))
  if (h < 0) throw new Error(`No header row with Task and Details in "${SHEET}"`)
  const col = (pred: (c: string) => boolean) => rows[h].findIndex((c) => pred(norm(c)))
  const cDeliv = col((c) => c === "deliverable"), cOrder = col((c) => c === "order")
  const cTask = col((c) => c === "task"), cDetails = col((c) => c.startsWith("details"))
  const out: SheetRow[] = []
  for (const r of rows.slice(h + 1)) {
    const details = normalizeDetails(r[cDetails] == null ? null : String(r[cDetails]))
    if (!details.ok) throw new Error(`Row "${r[cTask]}": ${details.error}`)
    if (!details.value || !String(r[cTask] ?? "").trim()) continue
    out.push({ deliverable: String(r[cDeliv]).trim(), order: Number(r[cOrder]), task: String(r[cTask]).trim(), details: details.value })
  }
  return out
}

async function main() {
  const write = process.argv.includes("--yes")
  const coachEmail = arg("coach")
  if (!coachEmail) { console.error("Pass --coach=<the coach's SIGNAL email>."); process.exit(1) }
  const db = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } })
  console.log(`Database: ${new URL(need("SUPABASE_URL")).hostname.split(".")[0]}`)

  const { data: coach } = await db.from("client_profiles").select("id, email").ilike("email", coachEmail.trim()).eq("is_coach", true).maybeSingle()
  if (!coach) { console.error(`No coach with the email ${coachEmail} in this database.`); process.exit(1) }
  console.log(`Coach: ${coach.email}`)

  const sheet = await sheetRows()
  console.log(`Sheet: ${sheet.length} tasks with details\n`)

  const { data: ms, error: mErr } = await db.from("coach_milestones").select("id, name").eq("coach_profile_id", coach.id)
  if (mErr) throw new Error(mErr.message)
  const milestones = (ms ?? []) as { id: string; name: string }[]
  const { data: as, error: aErr } = milestones.length
    ? await db.from("coach_milestone_activities").select("id, milestone_id, name, sort_order, details").in("milestone_id", milestones.map((m) => m.id))
    : { data: [], error: null }
  if (aErr) throw new Error(aErr.message)
  const lib = (as ?? []) as LibTask[]

  const fills: { task: LibTask; details: string; how: "name" | "order"; row: SheetRow }[] = []
  const kept: LibTask[] = []
  const unmatched: SheetRow[] = []
  const used = new Set<string>()
  for (const row of sheet) {
    const m = milestones.find((x) => norm(x.name) === norm(row.deliverable))
    const tasks = m ? lib.filter((t) => t.milestone_id === m.id) : []
    let how: "name" | "order" = "name"
    let t = tasks.find((x) => norm(x.name) === norm(row.task) && !used.has(x.id))
    if (!t) { t = tasks.find((x) => x.sort_order === row.order && !used.has(x.id)); how = "order" }
    if (!t) { unmatched.push(row); continue }
    used.add(t.id)
    if (t.details?.trim()) kept.push(t)
    else fills.push({ task: t, details: row.details, how, row })
  }

  console.log(`Library tasks to fill: ${fills.filter((f) => f.how === "name").length}`)
  for (const f of fills.filter((f) => f.how === "name")) console.log(`  ${f.task.name}`)
  const byOrder = fills.filter((f) => f.how === "order")
  if (byOrder.length) {
    console.log(`\nMatched by deliverable and order (the name differs; check these): ${byOrder.length}`)
    for (const f of byOrder) console.log(`  library "${f.task.name}"  <-  sheet "${f.row.task}"`)
  }
  if (kept.length) console.log(`\nAlready have details, left alone: ${kept.length}\n${kept.map((t) => `  ${t.name}`).join("\n")}`)
  if (unmatched.length) console.log(`\nNOT MATCHED, skipped: ${unmatched.length}\n${unmatched.map((r) => `  ${r.deliverable} / ${r.order}. ${r.task}`).join("\n")}`)

  // Client plan tasks copied from these library tasks, with no details yet.
  const finalDetails = new Map<string, string>()
  for (const f of fills) finalDetails.set(f.task.id, f.details)
  for (const t of kept) finalDetails.set(t.id, t.details!.trim())
  const libIds = [...finalDetails.keys()]
  const plan: { id: string; source_activity_id: string; name: string }[] = []
  for (let i = 0; i < libIds.length; i += 100) {
    const { data, error } = await db.from("coach_client_engagement_activities")
      .select("id, source_activity_id, name, details").in("source_activity_id", libIds.slice(i, i + 100))
    if (error) throw new Error(error.message)
    plan.push(...((data ?? []) as { id: string; source_activity_id: string; name: string; details: string | null }[]).filter((p) => !p.details?.trim()))
  }
  console.log(`\nClient plan tasks to fill: ${plan.length}`)
  const perTask = new Map<string, number>()
  for (const p of plan) perTask.set(p.name, (perTask.get(p.name) ?? 0) + 1)
  for (const [name, n] of perTask) console.log(`  ${name} x${n}`)

  if (!write) { console.log("\nDry run. Add --yes to write."); return }

  for (const f of fills) {
    const { error } = await db.from("coach_milestone_activities").update({ details: f.details }).eq("id", f.task.id).is("details", null)
    if (error) throw new Error(`${f.task.name}: ${error.message}`)
  }
  const bySource = new Map<string, string[]>()
  for (const p of plan) bySource.set(p.source_activity_id, [...(bySource.get(p.source_activity_id) ?? []), p.id])
  for (const [src, ids] of bySource) {
    const { error } = await db.from("coach_client_engagement_activities").update({ details: finalDetails.get(src) }).in("id", ids)
    if (error) throw new Error(`plan tasks from ${src}: ${error.message}`)
  }
  console.log(`\nWrote ${fills.length} library task(s) and ${plan.length} client plan task(s).`)
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
