#!/usr/bin/env tsx
// Load docs/WRN_SOW_Text.md into one coach's Settings: phase SOW subtitles and
// closing notes, deliverable SOW bullets, and the standard SOW sections.
//
// Dry run unless --apply. It refuses to overwrite SOW text the coach already
// has unless --overwrite. Every deliverable and phase named in the doc must
// exist for the coach (the package seed made them), or nothing is written.
//
// USAGE:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... COACH_EMAIL=peri+democoach@workforcereadynow.com \
//   NODE_OPTIONS=--use-system-ca npx tsx tests/sow/load-sow-text.ts [--apply] [--overwrite]
// Against prod, also set ALLOW_PROD=yes.
//
// Creds come from process.env only; this file never reads .env*.

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { SOW_SECTIONS, SOW_SECTION_LABEL, normalizeBullets, normalizeText, SOW_NOTE_MAX, SOW_SUBTITLE_MAX, type SowSection } from "../../lib/sow/model"
import { getSowLines, saveSowLines } from "../../lib/sow/service"

const PROD_REF = "ejhnokcnahauvrcbcmic" // DEVELOPMENT.md, "The mental model"
const DOC = "docs/WRN_SOW_Text.md"

const parseOnly = process.argv.includes("--parse-only")
const apply = process.argv.includes("--apply")
const overwrite = process.argv.includes("--overwrite")

function req(name: string, alt?: string): string {
  const v = process.env[name] || (alt ? process.env[alt] : undefined)
  if (!v) { console.error(`Missing ${name}`); process.exit(2) }
  return v
}
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase()

// ── Parse the doc ────────────────────────────────────────────────────────────

type Parsed = {
  subtitles: Map<string, string>
  notes: Map<string, string>
  bullets: { name: string; phase: string; lines: string[] }[]
  lines: { section: SowSection; body: string; show: { kind: "every" } | { kind: "in" | "out"; phase: string } }[]
}

function parse(md: string): Parsed {
  const out: Parsed = { subtitles: new Map(), notes: new Map(), bullets: [], lines: [] }
  const sectionByLabel = new Map(SOW_SECTIONS.map((s) => [norm(SOW_SECTION_LABEL[s]), s]))
  let h2 = ""
  let h3 = ""
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith("## ")) {
      // The doc's headings, by how they start ("Phase subtitles (shown as ...)").
      const t = norm(line.slice(3))
      h2 = ["phase subtitles", "phase closing notes", "deliverable sow bullets", "standard sections"].find((k) => t.startsWith(k)) ?? t
      h3 = ""
      continue
    }
    if (line.startsWith("### ")) {
      h3 = line.slice(4).trim()
      if (h2 === "deliverable sow bullets") {
        const m = h3.match(/^(.*)\(([^)]+)\)\s*$/)
        if (!m) throw new Error(`Deliverable heading without a phase: ${h3}`)
        out.bullets.push({ name: m[1].trim(), phase: m[2].trim(), lines: [] })
      }
      continue
    }
    if (h2 === "phase subtitles" || h2 === "phase closing notes") {
      const m = line.match(/^- ([^:]+):\s*(.+)$/)
      if (m) (h2 === "phase subtitles" ? out.subtitles : out.notes).set(m[1].trim(), m[2].trim())
      continue
    }
    if (h2 === "deliverable sow bullets" && line.startsWith("- ")) {
      const b = line.slice(2).trim()
      if (b !== "(no bullet)") out.bullets[out.bullets.length - 1].lines.push(b)
      continue
    }
    if (h2 === "standard sections" && line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim())
      if (cells.length !== 2 || cells[0] === "Line" || /^-+$/.test(cells[0])) continue
      const section = sectionByLabel.get(norm(h3))
      if (!section) throw new Error(`Unknown standard section: ${h3}`)
      const [body, showFor] = cells
      const not = showFor.match(/^Only when (.+) is NOT in the plan$/i)
      const show = norm(showFor) === "every plan" ? { kind: "every" as const }
        : not ? { kind: "out" as const, phase: not[1].trim() }
        : { kind: "in" as const, phase: showFor }
      out.lines.push({ section, body, show })
    }
  }
  return out
}

function must<T>(label: string, r: { data: T | null; error: any }): T {
  if (r.error) throw new Error(`${label}: ${r.error.message}`)
  return r.data as T
}

async function main() {
  const doc = parse(readFileSync(DOC, "utf8"))
  // --parse-only: what the doc holds, with no database.
  if (parseOnly) {
    console.log(`subtitles: ${[...doc.subtitles.keys()].join(", ")}`)
    console.log(`closing notes: ${[...doc.notes.keys()].join(", ")}`)
    for (const b of doc.bullets) console.log(`bullets: ${b.name} (${b.phase}) ${b.lines.length}`)
    for (const l of doc.lines) console.log(`line: ${l.section} [${l.show.kind}${"phase" in l.show ? ` ${l.show.phase}` : ""}] ${l.body.slice(0, 60)}`)
    return
  }

  const url = req("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
  const ref = new URL(url).hostname.split(".")[0]
  const email = req("COACH_EMAIL").trim().toLowerCase()
  if (ref === PROD_REF && process.env.ALLOW_PROD !== "yes") {
    console.error("This is PROD. Set ALLOW_PROD=yes to run against it.")
    process.exit(2)
  }
  const db = createClient(url, req("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } })
  console.log(`Project: ${ref}${ref === PROD_REF ? " (PROD)" : ""}   Mode: ${apply ? "APPLY" : "dry run"}${overwrite ? " +overwrite" : ""}`)

  const profiles = must("client_profiles", await db.from("client_profiles").select("id, email, is_coach").ilike("email", `%${email}%`)) as any[]
  const coach = profiles.filter((p) => p.email.trim().toLowerCase() === email)
  if (coach.length !== 1 || !coach[0].is_coach) throw new Error(`expected one coach profile for ${email}, found ${coach.length}`)
  const coachId: string = coach[0].id
  console.log(`Coach: ${email}  ${coachId}`)

  const phases = must("coach_phases (migration 20261008 applied?)", await db.from("coach_phases")
    .select("id, label, sow_subtitle, sow_note").eq("coach_profile_id", coachId)) as any[]
  const phaseByLabel = new Map(phases.map((p) => [norm(p.label), p]))
  const delivs = must("coach_milestones", await db.from("coach_milestones")
    .select("id, name, phase_id, sow_bullets").eq("coach_profile_id", coachId)) as any[]
  const delivByName = new Map(delivs.map((d) => [norm(d.name), d]))

  // ── Resolve everything before writing anything ──
  const problems: string[] = []
  const phaseOf = (label: string) => {
    const p = phaseByLabel.get(norm(label))
    if (!p) problems.push(`no phase "${label}" for this coach`)
    return p
  }
  const phaseWrites = new Map<string, { id: string; label: string; sow_subtitle?: string | null; sow_note?: string | null }>()
  for (const [label, text] of doc.subtitles) {
    const p = phaseOf(label); if (!p) continue
    const v = normalizeText(text, SOW_SUBTITLE_MAX, `${label} subtitle`)
    if ("error" in v) { problems.push(v.error); continue }
    phaseWrites.set(p.id, { ...(phaseWrites.get(p.id) ?? { id: p.id, label: p.label }), sow_subtitle: v.value })
  }
  for (const [label, text] of doc.notes) {
    const p = phaseOf(label); if (!p) continue
    const v = normalizeText(text, SOW_NOTE_MAX, `${label} closing note`)
    if ("error" in v) { problems.push(v.error); continue }
    phaseWrites.set(p.id, { ...(phaseWrites.get(p.id) ?? { id: p.id, label: p.label }), sow_note: v.value })
  }
  const bulletWrites: { id: string; name: string; value: string | null; count: number }[] = []
  for (const b of doc.bullets) {
    const d = delivByName.get(norm(b.name))
    if (!d) { problems.push(`no deliverable "${b.name}" for this coach`); continue }
    const p = phaseByLabel.get(norm(b.phase))
    if (p && d.phase_id !== p.id) console.log(`  note: "${b.name}" is not in ${b.phase} in SIGNAL; bullets load anyway`)
    const v = normalizeBullets(b.lines.join("\n"))
    if ("error" in v) { problems.push(`${b.name}: ${v.error}`); continue }
    bulletWrites.push({ id: d.id, name: d.name, value: v.value, count: b.lines.length })
  }
  const lineRows = doc.lines.map((l) => {
    if (l.show.kind === "every") return { section: l.section, body: l.body, show_for: "every_plan", phase_id: null, label: "Every plan" }
    const p = phaseOf(l.show.phase)
    return {
      section: l.section, body: l.body,
      show_for: l.show.kind === "in" ? "phase_in_plan" : "phase_not_in_plan", phase_id: p?.id ?? null,
      label: l.show.kind === "in" ? `Only with ${l.show.phase}` : `Only WITHOUT ${l.show.phase}`,
    }
  })

  // Existing SOW text this would replace.
  const existingLines = await getSowLines(db as any, coachId)
  const occupied = [
    ...phases.filter((p) => phaseWrites.has(p.id) && (p.sow_subtitle || p.sow_note)).map((p) => `phase ${p.label} has SOW text`),
    ...bulletWrites.filter((w) => delivByName.get(norm(w.name))?.sow_bullets).map((w) => `${w.name} has SOW bullets`),
    ...(existingLines.length ? [`${existingLines.length} standard lines exist`] : []),
  ]

  // ── The plan ──
  console.log(`\nPhases (${phaseWrites.size}):`)
  for (const w of phaseWrites.values()) {
    console.log(`  ${w.label}${w.sow_subtitle !== undefined ? `: subtitle "${w.sow_subtitle}"` : ""}`)
    if (w.sow_note) console.log(`       closing note: ${w.sow_note.slice(0, 90)}${w.sow_note.length > 90 ? "…" : ""}`)
  }
  console.log(`\nDeliverable bullets (${bulletWrites.length} deliverables, ${bulletWrites.reduce((n, w) => n + w.count, 0)} bullets):`)
  for (const w of bulletWrites) console.log(`  ${w.name}: ${w.count} bullet${w.count === 1 ? "" : "s"}`)
  console.log(`\nStandard lines (${lineRows.length}):`)
  for (const s of SOW_SECTIONS) {
    const rows = lineRows.filter((r) => r.section === s)
    console.log(`  ${SOW_SECTION_LABEL[s]} (${rows.length})`)
    for (const r of rows) console.log(`    [${r.label}] ${r.body.slice(0, 80)}${r.body.length > 80 ? "…" : ""}`)
  }

  if (problems.length) throw new Error(`Nothing written:\n  - ${problems.join("\n  - ")}`)
  if (occupied.length && !overwrite) {
    throw new Error(`Nothing written; this coach already has SOW text (re-run with --overwrite to replace it):\n  - ${occupied.join("\n  - ")}`)
  }
  if (!apply) { console.log("\nDry run: nothing written. Re-run with --apply."); return }

  // ── Write: standard lines first (all-or-nothing, through the app's own rules) ──
  const saved = await saveSowLines(db as any, coachId, lineRows.map(({ label, ...r }) => r))
  if (!saved.ok) throw new Error(`Standard lines: ${saved.error}`)
  const now = new Date().toISOString()
  for (const w of phaseWrites.values()) {
    const patch: Record<string, unknown> = { updated_at: now }
    if (w.sow_subtitle !== undefined) patch.sow_subtitle = w.sow_subtitle
    if (w.sow_note !== undefined) patch.sow_note = w.sow_note
    must(`phase ${w.label}`, await db.from("coach_phases").update(patch).eq("id", w.id).eq("coach_profile_id", coachId).select("id"))
  }
  for (const w of bulletWrites) {
    must(`bullets for ${w.name}`, await db.from("coach_milestones").update({ sow_bullets: w.value }).eq("id", w.id).eq("coach_profile_id", coachId).select("id"))
  }

  // ── Verify by reading back ──
  const backPhases = must("read phases", await db.from("coach_phases").select("id, sow_subtitle, sow_note").eq("coach_profile_id", coachId)) as any[]
  const backDelivs = must("read deliverables", await db.from("coach_milestones").select("id, sow_bullets").eq("coach_profile_id", coachId)) as any[]
  const backLines = await getSowLines(db as any, coachId)
  let bad = 0
  for (const w of phaseWrites.values()) {
    const b = backPhases.find((p) => p.id === w.id)
    if ((w.sow_subtitle !== undefined && b?.sow_subtitle !== w.sow_subtitle) || (w.sow_note !== undefined && b?.sow_note !== w.sow_note)) { bad++; console.log(`  FAIL phase ${w.label}`) }
  }
  for (const w of bulletWrites) {
    if ((backDelivs.find((d) => d.id === w.id)?.sow_bullets ?? null) !== w.value) { bad++; console.log(`  FAIL bullets ${w.name}`) }
  }
  if (backLines.length !== lineRows.length) { bad++; console.log(`  FAIL ${backLines.length} standard lines read back, expected ${lineRows.length}`) }
  const playbook = backLines.find((l) => /Playbook/.test(l.body))
  const land = phaseByLabel.get("land")
  if (!playbook || playbook.show_for !== "phase_not_in_plan" || playbook.phase_id !== land?.id) { bad++; console.log("  FAIL the Playbook line is not tied to 'Land NOT in the plan'") }
  console.log(`\nRead back: ${backPhases.filter((p) => p.sow_subtitle || p.sow_note).length} phases with SOW text, ` +
    `${backDelivs.filter((d) => d.sow_bullets).length} deliverables with bullets, ${backLines.length} standard lines`)
  if (bad) throw new Error("read-back does not match the doc")
  console.log("\nSOW text loaded and verified.")
}

main().catch((e) => { console.error((e as Error).message ?? e); process.exit(1) })
