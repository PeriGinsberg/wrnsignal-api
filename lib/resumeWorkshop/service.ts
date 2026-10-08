// lib/resumeWorkshop/service.ts
//
// The Resume Workshop on the server. Everything takes the coaching
// relationship (coach_clients.id) the caller has already been authorized for,
// and every row it touches is checked to belong to that relationship's
// workshop, so an id from another client's workshop is "not found".
//
// SAVES NEVER OVERWRITE NEWER TEXT. Each editable field has a version. A save
// names the version it was typed against; if the field has moved on (another
// tab or device saved first), it is refused with the current value, and the
// screen lets the coach choose. Every accepted save is also written to
// resume_workshop_history.
//
// THE RESUME ON FILE IS ONLY READ. Nothing here writes client_personas or
// client_profiles. Resume text the coach pastes is stored on the workshop.

import type { SupabaseClient } from "@supabase/supabase-js"
import { getConsult } from "../prospects/workflow"
import { TABS, isWorkshopTab, type WorkshopTab } from "./model"
import { prefillFromResume } from "./prefill"
import { exportFileName, workshopMarkdown, type ExportCapture, type ExportEntry } from "./exportMarkdown"

export const TITLE_MAX = 300
export const NOTES_MAX = 200_000
export const RESUME_MAX = 100_000

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number; current?: unknown }
const fail = (error: string, status = 400, current?: unknown): { ok: false; error: string; status: number; current?: unknown } =>
  ({ ok: false, error, status, ...(current !== undefined ? { current } : {}) })

export type Workshop = {
  id: string
  coach_client_id: string
  workshop_date: string
  general_notes: string
  general_version: number
  pasted_resume_text: string | null
  created_at: string
}
export type Entry = {
  id: string
  workshop_id: string
  tab: WorkshopTab
  title: string
  title_version: number
  notes: string
  notes_version: number
  source: "coach" | "resume"
  resume_excerpt: string | null
  sort_order: number
  created_at: string
}
export type Capture = {
  id: string
  workshop_id: string
  body: string
  body_version: number
  copied_to_entry_id: string | null
  moved_to_entry_id: string | null
  moved_at: string | null
  created_at: string
}

const WORKSHOP_COLS = "id, coach_client_id, workshop_date, general_notes, general_version, pasted_resume_text, created_at"
const ENTRY_COLS = "id, workshop_id, tab, title, title_version, notes, notes_version, source, resume_excerpt, sort_order, created_at"
const CAPTURE_COLS = "id, workshop_id, body, body_version, copied_to_entry_id, moved_to_entry_id, moved_at, created_at"

const now = () => new Date().toISOString()

async function workshopFor(db: SupabaseClient, coachClientId: string): Promise<Workshop | null> {
  const { data, error } = await db.from("resume_workshops").select(WORKSHOP_COLS).eq("coach_client_id", coachClientId).maybeSingle()
  if (error) throw new Error(`Failed to read the workshop: ${error.message}`)
  return (data as Workshop | null) ?? null
}

async function history(db: SupabaseClient, row: { workshop_id: string; entity: string; entity_id: string; field: string; value: string | null; version: number; saved_by: string | null }) {
  const { error } = await db.from("resume_workshop_history").insert(row)
  if (error) console.error("[resume-workshop] history write failed:", error.message)
}

// ── Reading ──────────────────────────────────────────────────────────────────

export type ResumeOnFile = { source: "persona" | "profile" | "pasted" | null; label: string | null; text: string | null }

/** The resume to show beside the notes: the client's default persona, then their profile, then what the coach pasted. */
export async function resumeOnFile(db: SupabaseClient, coachClientId: string, pasted: string | null): Promise<ResumeOnFile> {
  const { data: cc } = await db.from("coach_clients").select("client_profile_id").eq("id", coachClientId).maybeSingle()
  const profileId = (cc as { client_profile_id: string | null } | null)?.client_profile_id ?? null
  if (profileId) {
    const { data: personas } = await db.from("client_personas").select("name, resume_text, is_default, display_order, archived_at")
      .eq("profile_id", profileId)
    const live = ((personas ?? []) as { name: string; resume_text: string | null; is_default: boolean; display_order: number; archived_at: string | null }[])
      .filter((p) => !p.archived_at && p.resume_text?.trim())
      .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.display_order - b.display_order)
    if (live[0]) return { source: "persona", label: `Persona: ${live[0].name}`, text: live[0].resume_text }
    const { data: prof } = await db.from("client_profiles").select("resume_text").eq("id", profileId).maybeSingle()
    const t = (prof as { resume_text: string | null } | null)?.resume_text
    if (t?.trim()) return { source: "profile", label: "Profile resume", text: t }
  }
  if (pasted?.trim()) return { source: "pasted", label: "Pasted into this workshop", text: pasted }
  return { source: null, label: null, text: null }
}

export type ConsultContext = {
  consult: Record<string, unknown> | null
  targets: { roles: unknown; industries: unknown; locations: unknown }
  engagements: { name: string; status: string; deliverables: string[] }[]
  booking_form: Record<string, unknown> | null
}

/** The consultation and engagement goals, read-only, for the side panel. */
export async function consultContext(db: SupabaseClient, coachClientId: string): Promise<ConsultContext> {
  const consult = await getConsult(db, coachClientId)
  const hasConsult = Object.entries(consult).some(([k, v]) => k !== "coach_client_id" && v !== null && !(Array.isArray(v) && !v.length))
  const { data: cc } = await db.from("coach_clients").select("target_roles, target_industries, target_locations").eq("id", coachClientId).maybeSingle()
  const t = (cc ?? {}) as { target_roles?: unknown; target_industries?: unknown; target_locations?: unknown }
  const { data: engs } = await db.from("coach_client_engagements").select("id, name, proposal_status").eq("coach_client_id", coachClientId)
  const list = (engs ?? []) as { id: string; name: string; proposal_status: string }[]
  const engagements: ConsultContext["engagements"] = []
  for (const e of list.filter((x) => x.proposal_status !== "declined")) {
    const { data: ds } = await db.from("coach_client_engagement_deliverables").select("name, not_needed, sort_order").eq("engagement_id", e.id)
    const delivs = ((ds ?? []) as { name: string; not_needed: boolean; sort_order: number }[]).filter((d) => !d.not_needed).sort((a, b) => a.sort_order - b.sort_order)
    engagements.push({ name: e.name, status: e.proposal_status, deliverables: delivs.map((d) => d.name) })
  }
  const { data: forms } = await db.from("coach_client_events").select("context, created_at")
    .eq("coach_client_id", coachClientId).eq("event_type", "booking_form_submitted").order("created_at", { ascending: false }).limit(1)
  const answers = ((forms ?? [])[0] as { context?: { answers?: Record<string, unknown> } } | undefined)?.context?.answers ?? null
  return {
    consult: hasConsult ? (consult as unknown as Record<string, unknown>) : null,
    targets: { roles: t.target_roles ?? null, industries: t.target_industries ?? null, locations: t.target_locations ?? null },
    engagements,
    booking_form: answers,
  }
}

async function clientName(db: SupabaseClient, coachClientId: string): Promise<string> {
  const { data: cc } = await db.from("coach_clients").select("name, client_profile_id").eq("id", coachClientId).maybeSingle()
  const row = cc as { name: string | null; client_profile_id: string | null } | null
  if (row?.name?.trim()) return row.name.trim()
  if (row?.client_profile_id) {
    const { data: p } = await db.from("client_profiles").select("name, email").eq("id", row.client_profile_id).maybeSingle()
    const prof = p as { name: string | null; email: string | null } | null
    if (prof?.name?.trim()) return prof.name.trim()
    if (prof?.email) return prof.email
  }
  return "Client"
}

async function entriesOf(db: SupabaseClient, workshopId: string): Promise<Entry[]> {
  const { data, error } = await db.from("resume_workshop_entries").select(ENTRY_COLS).eq("workshop_id", workshopId).is("deleted_at", null)
  if (error) throw new Error(`Failed to read entries: ${error.message}`)
  const order = new Map(TABS.map((t, i) => [t, i]))
  return ((data ?? []) as Entry[]).sort((a, b) =>
    (order.get(a.tab)! - order.get(b.tab)!) || a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
}

async function capturesOf(db: SupabaseClient, workshopId: string): Promise<Capture[]> {
  const { data, error } = await db.from("resume_workshop_captures").select(CAPTURE_COLS).eq("workshop_id", workshopId).is("deleted_at", null)
  if (error) throw new Error(`Failed to read Quick Capture: ${error.message}`)
  return ((data ?? []) as Capture[]).sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export type Bundle = {
  client_name: string
  workshop: Workshop | null
  entries: Entry[]
  captures: Capture[]
  resume: ResumeOnFile
  consult: ConsultContext
}

export async function getBundle(db: SupabaseClient, coachClientId: string): Promise<Bundle> {
  const ws = await workshopFor(db, coachClientId)
  const [name, resume, consult, entries, captures] = await Promise.all([
    clientName(db, coachClientId),
    resumeOnFile(db, coachClientId, ws?.pasted_resume_text ?? null),
    consultContext(db, coachClientId),
    ws ? entriesOf(db, ws.id) : Promise.resolve([] as Entry[]),
    ws ? capturesOf(db, ws.id) : Promise.resolve([] as Capture[]),
  ])
  return { client_name: name, workshop: ws, entries, captures, resume, consult }
}

// ── Starting, and entries from the resume ────────────────────────────────────

async function insertPrefill(db: SupabaseClient, workshopId: string, resumeText: string | null): Promise<number> {
  const rows = prefillFromResume(resumeText)
  if (!rows.length) return 0
  const { error } = await db.from("resume_workshop_entries").insert(rows.map((r, i) => ({
    workshop_id: workshopId, tab: r.tab, title: r.title, title_version: 0, notes: "", notes_version: 0,
    source: "resume", resume_excerpt: r.resume_excerpt, sort_order: i, deleted_at: null,
  })))
  if (error) throw new Error(`Failed to add entries from the resume: ${error.message}`)
  return rows.length
}

/** Open the relationship's workshop, creating it (with entries from the resume on file) the first time. */
export async function startWorkshop(db: SupabaseClient, coachClientId: string, actor: string): Promise<Result<Workshop>> {
  const existing = await workshopFor(db, coachClientId)
  if (existing) return { ok: true, data: existing }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.COACH_TIMEZONE || "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const { data, error } = await db.from("resume_workshops").insert({
    coach_client_id: coachClientId, created_by: actor, workshop_date: today, general_notes: "", general_version: 0, pasted_resume_text: null,
  }).select(WORKSHOP_COLS).single()
  if (error || !data) {
    // Two first opens at once: the loser reads what the winner made.
    const again = await workshopFor(db, coachClientId)
    if (again) return { ok: true, data: again }
    return fail(`Failed to start the workshop: ${error?.message ?? "no row"}`, 500)
  }
  const ws = data as Workshop
  const resume = await resumeOnFile(db, coachClientId, null)
  await insertPrefill(db, ws.id, resume.text)
  return { ok: true, data: ws }
}

/** Entries from a resume pasted after the workshop started. Only once: never duplicates resume entries. */
export async function prefillFromPasted(db: SupabaseClient, coachClientId: string): Promise<Result<number>> {
  const ws = await workshopFor(db, coachClientId)
  if (!ws) return fail("Start the workshop first.", 409)
  const { data: already } = await db.from("resume_workshop_entries").select("id").eq("workshop_id", ws.id).eq("source", "resume").is("deleted_at", null).limit(1)
  if ((already ?? []).length) return fail("Entries from the resume already exist.", 409)
  const resume = await resumeOnFile(db, coachClientId, ws.pasted_resume_text)
  return { ok: true, data: await insertPrefill(db, ws.id, resume.text) }
}

// ── The workshop's own fields ────────────────────────────────────────────────

export async function saveGeneral(
  db: SupabaseClient, coachClientId: string, args: { value: unknown; baseVersion: unknown; actor: string },
): Promise<Result<Workshop>> {
  const ws = await workshopFor(db, coachClientId)
  if (!ws) return fail("Workshop not found", 404)
  if (typeof args.value !== "string" || args.value.length > NOTES_MAX) return fail("Notes must be text, at most 200,000 characters.")
  if (typeof args.baseVersion !== "number") return fail("base_version is required.")
  const { data } = await db.from("resume_workshops")
    .update({ general_notes: args.value, general_version: args.baseVersion + 1, updated_at: now() })
    .eq("id", ws.id).eq("general_version", args.baseVersion).select(WORKSHOP_COLS).maybeSingle()
  if (!data) return fail("These notes were changed somewhere else.", 409, await workshopFor(db, coachClientId))
  await history(db, { workshop_id: ws.id, entity: "workshop", entity_id: ws.id, field: "general_notes", value: args.value, version: args.baseVersion + 1, saved_by: args.actor })
  return { ok: true, data: data as Workshop }
}

export async function setWorkshopDate(db: SupabaseClient, coachClientId: string, day: unknown): Promise<Result<Workshop>> {
  const ws = await workshopFor(db, coachClientId)
  if (!ws) return fail("Workshop not found", 404)
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail("The date must be YYYY-MM-DD.")
  const { data, error } = await db.from("resume_workshops").update({ workshop_date: day, updated_at: now() }).eq("id", ws.id).select(WORKSHOP_COLS).single()
  if (error || !data) return fail(`Failed to save the date: ${error?.message ?? "no row"}`, 500)
  return { ok: true, data: data as Workshop }
}

export async function setPastedResume(db: SupabaseClient, coachClientId: string, value: unknown, actor: string): Promise<Result<Workshop>> {
  const ws = await workshopFor(db, coachClientId)
  if (!ws) return fail("Workshop not found", 404)
  if (value !== null && (typeof value !== "string" || value.length > RESUME_MAX)) return fail("Resume text must be at most 100,000 characters.")
  const text = typeof value === "string" && value.trim() ? value : null
  const { data, error } = await db.from("resume_workshops").update({ pasted_resume_text: text, updated_at: now() }).eq("id", ws.id).select(WORKSHOP_COLS).single()
  if (error || !data) return fail(`Failed to save the resume text: ${error?.message ?? "no row"}`, 500)
  await history(db, { workshop_id: ws.id, entity: "workshop", entity_id: ws.id, field: "pasted_resume_text", value: text, version: 0, saved_by: actor })
  return { ok: true, data: data as Workshop }
}

// ── Entries ──────────────────────────────────────────────────────────────────

async function ownEntry(db: SupabaseClient, coachClientId: string, entryId: unknown): Promise<{ ws: Workshop; entry: Entry } | null> {
  if (typeof entryId !== "string") return null
  const ws = await workshopFor(db, coachClientId)
  if (!ws) return null
  const { data } = await db.from("resume_workshop_entries").select(ENTRY_COLS).eq("id", entryId).eq("workshop_id", ws.id).is("deleted_at", null).maybeSingle()
  return data ? { ws, entry: data as Entry } : null
}

export async function addEntry(db: SupabaseClient, coachClientId: string, tab: unknown, title: unknown): Promise<Result<Entry>> {
  const ws = await workshopFor(db, coachClientId)
  if (!ws) return fail("Start the workshop first.", 409)
  if (!isWorkshopTab(tab)) return fail("Unknown tab.")
  const t = typeof title === "string" ? title.slice(0, TITLE_MAX) : ""
  const { data: last } = await db.from("resume_workshop_entries").select("sort_order").eq("workshop_id", ws.id).eq("tab", tab)
  const next = Math.max(-1, ...((last ?? []) as { sort_order: number }[]).map((r) => r.sort_order)) + 1
  const { data, error } = await db.from("resume_workshop_entries")
    .insert({ workshop_id: ws.id, tab, title: t, title_version: 0, notes: "", notes_version: 0, source: "coach", resume_excerpt: null, sort_order: next, deleted_at: null })
    .select(ENTRY_COLS).single()
  if (error || !data) return fail(`Failed to add the entry: ${error?.message ?? "no row"}`, 500)
  return { ok: true, data: data as Entry }
}

/** Save an entry's title or notes, against the version it was typed on. */
export async function saveEntryField(
  db: SupabaseClient, coachClientId: string,
  args: { entryId: unknown; field: unknown; value: unknown; baseVersion: unknown; actor: string },
): Promise<Result<Entry>> {
  const own = await ownEntry(db, coachClientId, args.entryId)
  if (!own) return fail("Entry not found", 404)
  if (args.field !== "title" && args.field !== "notes") return fail("field must be title or notes.")
  const max = args.field === "title" ? TITLE_MAX : NOTES_MAX
  if (typeof args.value !== "string" || args.value.length > max) return fail(`The ${args.field} must be text, at most ${max.toLocaleString("en-US")} characters.`)
  if (typeof args.baseVersion !== "number") return fail("base_version is required.")
  const vcol = `${args.field}_version`
  const { data } = await db.from("resume_workshop_entries")
    .update({ [args.field]: args.value, [vcol]: args.baseVersion + 1, updated_at: now() })
    .eq("id", own.entry.id).eq(vcol, args.baseVersion).is("deleted_at", null).select(ENTRY_COLS).maybeSingle()
  if (!data) {
    const cur = await ownEntry(db, coachClientId, args.entryId)
    return fail("This entry was changed somewhere else.", 409, cur?.entry ?? null)
  }
  await history(db, { workshop_id: own.ws.id, entity: "entry", entity_id: own.entry.id, field: args.field, value: args.value, version: args.baseVersion + 1, saved_by: args.actor })
  return { ok: true, data: data as Entry }
}

/** Delete an entry (the screen confirms first). Kept in the table, out of the workshop and the export. */
export async function deleteEntry(db: SupabaseClient, coachClientId: string, entryId: unknown, actor: string): Promise<Result<true>> {
  const own = await ownEntry(db, coachClientId, entryId)
  if (!own) return fail("Entry not found", 404)
  const { error } = await db.from("resume_workshop_entries").update({ deleted_at: now() }).eq("id", own.entry.id)
  if (error) return fail(`Failed to delete the entry: ${error.message}`, 500)
  await history(db, { workshop_id: own.ws.id, entity: "entry", entity_id: own.entry.id, field: "deleted", value: own.entry.notes, version: own.entry.notes_version, saved_by: actor })
  return { ok: true, data: true }
}

// ── Quick Capture ────────────────────────────────────────────────────────────

async function ownCapture(db: SupabaseClient, coachClientId: string, captureId: unknown): Promise<{ ws: Workshop; capture: Capture } | null> {
  if (typeof captureId !== "string") return null
  const ws = await workshopFor(db, coachClientId)
  if (!ws) return null
  const { data } = await db.from("resume_workshop_captures").select(CAPTURE_COLS).eq("id", captureId).eq("workshop_id", ws.id).is("deleted_at", null).maybeSingle()
  return data ? { ws, capture: data as Capture } : null
}

export async function addCapture(db: SupabaseClient, coachClientId: string, body: unknown, actor: string): Promise<Result<Capture>> {
  const ws = await workshopFor(db, coachClientId)
  if (!ws) return fail("Start the workshop first.", 409)
  if (body !== undefined && (typeof body !== "string" || body.length > NOTES_MAX)) return fail("A note must be text.")
  const text = typeof body === "string" ? body : ""
  const { data, error } = await db.from("resume_workshop_captures").insert({
    workshop_id: ws.id, body: text, body_version: text ? 1 : 0, copied_to_entry_id: null, moved_to_entry_id: null, moved_at: null, deleted_at: null,
  }).select(CAPTURE_COLS).single()
  if (error || !data) return fail(`Failed to add the note: ${error?.message ?? "no row"}`, 500)
  if (text) await history(db, { workshop_id: ws.id, entity: "capture", entity_id: (data as Capture).id, field: "body", value: text, version: 1, saved_by: actor })
  return { ok: true, data: data as Capture }
}

export async function saveCapture(
  db: SupabaseClient, coachClientId: string, args: { captureId: unknown; value: unknown; baseVersion: unknown; actor: string },
): Promise<Result<Capture>> {
  const own = await ownCapture(db, coachClientId, args.captureId)
  if (!own) return fail("Note not found", 404)
  if (typeof args.value !== "string" || args.value.length > NOTES_MAX) return fail("A note must be text.")
  if (typeof args.baseVersion !== "number") return fail("base_version is required.")
  const { data } = await db.from("resume_workshop_captures")
    .update({ body: args.value, body_version: args.baseVersion + 1, updated_at: now() })
    .eq("id", own.capture.id).eq("body_version", args.baseVersion).is("deleted_at", null).select(CAPTURE_COLS).maybeSingle()
  if (!data) {
    const cur = await ownCapture(db, coachClientId, args.captureId)
    return fail("This note was changed somewhere else.", 409, cur?.capture ?? null)
  }
  await history(db, { workshop_id: own.ws.id, entity: "capture", entity_id: own.capture.id, field: "body", value: args.value, version: args.baseVersion + 1, saved_by: args.actor })
  return { ok: true, data: data as Capture }
}

export async function deleteCapture(db: SupabaseClient, coachClientId: string, captureId: unknown, actor: string): Promise<Result<true>> {
  const own = await ownCapture(db, coachClientId, captureId)
  if (!own) return fail("Note not found", 404)
  const { error } = await db.from("resume_workshop_captures").update({ deleted_at: now() }).eq("id", own.capture.id)
  if (error) return fail(`Failed to delete the note: ${error.message}`, 500)
  await history(db, { workshop_id: own.ws.id, entity: "capture", entity_id: own.capture.id, field: "deleted", value: own.capture.body, version: own.capture.body_version, saved_by: actor })
  return { ok: true, data: true }
}

/**
 * Put a Quick Capture note into an entry: its text is added to the end of the
 * entry's notes. "copy" keeps the note in Quick Capture; "move" marks it moved
 * (it leaves the active list but stays in the export, labelled). Retries once
 * if the entry's notes were saved at the same moment.
 */
export async function captureToEntry(
  db: SupabaseClient, coachClientId: string,
  args: { captureId: unknown; entryId: unknown; mode: unknown; actor: string },
): Promise<Result<{ entry: Entry; capture: Capture }>> {
  if (args.mode !== "copy" && args.mode !== "move") return fail("mode must be copy or move.")
  const cap = await ownCapture(db, coachClientId, args.captureId)
  if (!cap) return fail("Note not found", 404)
  if (!cap.capture.body.trim()) return fail("The note is empty.")
  for (let attempt = 0; attempt < 2; attempt++) {
    const own = await ownEntry(db, coachClientId, args.entryId)
    if (!own) return fail("Entry not found", 404)
    const e = own.entry
    const notes = e.notes.trim() ? `${e.notes.replace(/\s+$/, "")}\n\n${cap.capture.body}` : cap.capture.body
    if (notes.length > NOTES_MAX) return fail("The entry's notes would be too long.")
    const { data } = await db.from("resume_workshop_entries")
      .update({ notes, notes_version: e.notes_version + 1, updated_at: now() })
      .eq("id", e.id).eq("notes_version", e.notes_version).select(ENTRY_COLS).maybeSingle()
    if (!data) continue
    await history(db, { workshop_id: own.ws.id, entity: "entry", entity_id: e.id, field: "notes", value: notes, version: e.notes_version + 1, saved_by: args.actor })
    const patch = args.mode === "move"
      ? { moved_to_entry_id: e.id, moved_at: now(), updated_at: now() }
      : { copied_to_entry_id: e.id, updated_at: now() }
    const { data: c, error } = await db.from("resume_workshop_captures").update(patch).eq("id", cap.capture.id).select(CAPTURE_COLS).single()
    if (error || !c) return fail(`The text was added, but the note could not be marked: ${error?.message ?? "no row"}`, 500)
    return { ok: true, data: { entry: data as Entry, capture: c as Capture } }
  }
  return fail("The entry is being edited. Try again.", 409)
}

// ── Export ───────────────────────────────────────────────────────────────────

export async function buildExport(db: SupabaseClient, coachClientId: string): Promise<Result<{ filename: string; markdown: string }>> {
  const ws = await workshopFor(db, coachClientId)
  if (!ws) return fail("Workshop not found", 404)
  const [name, entries, captures] = await Promise.all([clientName(db, coachClientId), entriesOf(db, ws.id), capturesOf(db, ws.id)])
  const { data: cc } = await db.from("coach_clients").select("coach_profile_id").eq("id", coachClientId).maybeSingle()
  const coachId = (cc as { coach_profile_id: string } | null)?.coach_profile_id
  const { data: coach } = coachId ? await db.from("client_profiles").select("name").eq("id", coachId).maybeSingle() : { data: null }
  const markdown = workshopMarkdown({
    clientName: name,
    coachName: (coach as { name: string | null } | null)?.name ?? null,
    workshopDate: ws.workshop_date,
    exportedAt: new Date().toLocaleString("en-US", { timeZone: process.env.COACH_TIMEZONE || "America/New_York", dateStyle: "long", timeStyle: "short" }),
    generalNotes: ws.general_notes,
    entries: entries as ExportEntry[],
    captures: captures as ExportCapture[],
  })
  return { ok: true, data: { filename: exportFileName(name, ws.workshop_date), markdown } }
}

