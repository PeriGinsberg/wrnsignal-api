// app/api/coach/coach-clients/[id]/resume-workshop/notes/[noteId]/route.ts
//
// PATCH { body } (autosave) or DELETE one of the caller's own Resume Workshop
// coach notes. Another coach's note matches no row and answers 404.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../_lib/cors"
import { errStatus } from "../../../../../../_lib/coachEngagements"
import { deleteNote, saveNote } from "@/lib/resumeWorkshop/coachNotes"
import { authorizeWorkshop } from "../../../../../../_lib/resumeWorkshopAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type P = { params: Promise<{ id: string; noteId: string }> }

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PATCH(req: NextRequest, { params }: P) {
  try {
    const { id, noteId } = await params
    const a = await authorizeWorkshop(req, id)
    if ("error" in a) return a.error
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const r = await saveNote(a.db, id, noteId, b.body, a.me)
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, note: r.data })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}

export async function DELETE(req: NextRequest, { params }: P) {
  try {
    const { id, noteId } = await params
    const a = await authorizeWorkshop(req, id)
    if ("error" in a) return a.error
    const r = await deleteNote(a.db, id, noteId, a.me)
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
