// app/api/coach/clients/[clientId]/workbooks/[workbookId]/notes/[noteId]/route.ts
// PATCH (autosave) or DELETE one of the caller's own notes. The update and
// delete policies match only the author's rows, so another coach's note
// changes zero rows and answers 404.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../../_lib/cors"
import { workbookError } from "../../../../../../../_lib/workbookError"
import { must } from "../../../../../../../_lib/must"
import { coachWorkbookScope } from "@/lib/workbook/server"
import { NOTE_COLUMNS, NOTE_MAX } from "@/lib/workbook/notes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type P = { params: Promise<{ clientId: string; workbookId: string; noteId: string }> }

const NOT_YOURS = "Note not found, or it is another coach's note."

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

async function onClient(supabase: any, workbookId: string, subjectId: string) {
  return !!must(
    await supabase.from("workbooks").select("id").eq("id", workbookId).eq("client_profile_id", subjectId).maybeSingle(),
    "read workbook",
  )
}

export async function PATCH(req: NextRequest, { params }: P) {
  try {
    const { clientId, workbookId, noteId } = await params
    const { supabase, scope } = await coachWorkbookScope(req, clientId)
    const b = await req.json().catch(() => ({}))
    if (typeof b.body !== "string") return withCorsJson(req, { ok: false, error: "body is required" }, 400)
    if (b.body.length > NOTE_MAX) return withCorsJson(req, { ok: false, error: "That note is too long" }, 400)
    if (!(await onClient(supabase, workbookId, scope.subjectId))) return withCorsJson(req, { ok: false, error: "Workbook not found" }, 404)

    const rows = (must(
      await supabase.from("workbook_coach_notes").update({ body: b.body })
        .eq("id", noteId).eq("workbook_id", workbookId).eq("coach_profile_id", scope.actorId)
        .select(NOTE_COLUMNS),
      "save note",
    ) ?? []) as any[]
    if (!rows.length) return withCorsJson(req, { ok: false, error: NOT_YOURS }, 404)
    return withCorsJson(req, { ok: true, note: rows[0] }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}

export async function DELETE(req: NextRequest, { params }: P) {
  try {
    const { clientId, workbookId, noteId } = await params
    const { supabase, scope } = await coachWorkbookScope(req, clientId)
    if (!(await onClient(supabase, workbookId, scope.subjectId))) return withCorsJson(req, { ok: false, error: "Workbook not found" }, 404)

    const rows = (must(
      await supabase.from("workbook_coach_notes").delete()
        .eq("id", noteId).eq("workbook_id", workbookId).eq("coach_profile_id", scope.actorId)
        .select("id"),
      "delete note",
    ) ?? []) as any[]
    if (!rows.length) return withCorsJson(req, { ok: false, error: NOT_YOURS }, 404)
    return withCorsJson(req, { ok: true }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
