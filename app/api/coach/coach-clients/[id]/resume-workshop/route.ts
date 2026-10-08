// app/api/coach/coach-clients/[id]/resume-workshop/route.ts
//
// One client's Resume Workshop (coach only; the client never reaches it).
//
//   GET   the workspace: { client_name, workshop (null before the first open),
//         entries, captures, resume (the resume on file, read-only), consult
//         (consultation and engagement goals, read-only) }.
//   POST  { action, ... }:
//           start                                  create it (entries from the resume on file)
//           general       { value, base_version }  general workshop notes
//           date          { value }                workshop date, YYYY-MM-DD
//           paste_resume  { value }                resume text when none is on file
//           prefill_pasted                         entries from the pasted resume
//           add_entry     { tab, title? }
//           save_entry    { entry_id, field: title|notes, value, base_version }
//           delete_entry  { entry_id }
//           add_capture   { body? }
//           save_capture  { capture_id, value, base_version }
//           delete_capture { capture_id }
//           capture_to_entry { capture_id, entry_id, mode: copy|move }
//         A stale save is refused 409 with { current }: the screen decides.
//
// Access: the relationship's coach or their delegate, on an active
// relationship; the same check as the client's plan. The rules are in
// lib/resumeWorkshop/service.ts.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { errStatus, getSupabaseAdmin, isCoachClientOwnedByCoach, resolveCoach } from "../../../../_lib/coachEngagements"
import {
  addCapture, addEntry, captureToEntry, deleteCapture, deleteEntry, getBundle, prefillFromPasted,
  saveCapture, saveEntryField, saveGeneral, setPastedResume, setWorkshopDate, startWorkshop,
  type Result,
} from "@/lib/resumeWorkshop/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

async function authorize(req: NextRequest, id: string) {
  const { coachProfileId, error } = await resolveCoach(req)
  if (error) return { error }
  const db = getSupabaseAdmin()
  if (!(await isCoachClientOwnedByCoach(db, coachProfileId, id))) {
    return { error: withCorsJson(req, { ok: false, error: "Client not found" }, 404) }
  }
  return { db, coachProfileId }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const a = await authorize(req, id)
    if ("error" in a) return a.error
    return withCorsJson(req, { ok: true, ...(await getBundle(a.db, id)) })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const a = await authorize(req, id)
    if ("error" in a) return a.error
    const { db, coachProfileId: actor } = a
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>

    let r: Result<unknown>
    switch (b.action) {
      case "start": r = await startWorkshop(db, id, actor); break
      case "general": r = await saveGeneral(db, id, { value: b.value, baseVersion: b.base_version, actor }); break
      case "date": r = await setWorkshopDate(db, id, b.value); break
      case "paste_resume": r = await setPastedResume(db, id, b.value ?? null, actor); break
      case "prefill_pasted": r = await prefillFromPasted(db, id); break
      case "add_entry": r = await addEntry(db, id, b.tab, b.title); break
      case "save_entry": r = await saveEntryField(db, id, { entryId: b.entry_id, field: b.field, value: b.value, baseVersion: b.base_version, actor }); break
      case "delete_entry": r = await deleteEntry(db, id, b.entry_id, actor); break
      case "add_capture": r = await addCapture(db, id, b.body, actor); break
      case "save_capture": r = await saveCapture(db, id, { captureId: b.capture_id, value: b.value, baseVersion: b.base_version, actor }); break
      case "delete_capture": r = await deleteCapture(db, id, b.capture_id, actor); break
      case "capture_to_entry": r = await captureToEntry(db, id, { captureId: b.capture_id, entryId: b.entry_id, mode: b.mode, actor }); break
      default: return withCorsJson(req, { ok: false, error: "Unknown action" }, 400)
    }
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error, current: r.current ?? null }, r.status)
    return withCorsJson(req, { ok: true, data: r.data })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
