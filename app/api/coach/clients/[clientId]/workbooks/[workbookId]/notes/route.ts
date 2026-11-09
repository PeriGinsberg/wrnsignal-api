// app/api/coach/clients/[clientId]/workbooks/[workbookId]/notes/route.ts
// GET every coach's notes on this workbook (not just the caller's), with the
// authors' names and the caller's own id so the page knows which it may edit.
// POST a new note on a section, authored by the caller. Coach-only: the client
// has no route and no policy on workbook_coach_notes.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../_lib/cors"
import { workbookError } from "../../../../../../_lib/workbookError"
import { must } from "../../../../../../_lib/must"
import { coachWorkbookScope } from "@/lib/workbook/server"
import { NOTE_COLUMNS, NOTE_MAX, authorNames, loadNotes } from "@/lib/workbook/notes"
import { anchorError, GENERAL_SECTION_ID, type WorkbookContent } from "@/lib/workbook/content"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

async function readWorkbook(supabase: any, workbookId: string, subjectId: string) {
  return must(
    await supabase.from("workbooks").select("id, content").eq("id", workbookId).eq("client_profile_id", subjectId).maybeSingle(),
    "read workbook",
  ) as { id: string; content: WorkbookContent } | null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ clientId: string; workbookId: string }> }) {
  try {
    const { clientId, workbookId } = await params
    const { supabase, scope } = await coachWorkbookScope(req, clientId)
    if (!(await readWorkbook(supabase, workbookId, scope.subjectId))) return withCorsJson(req, { ok: false, error: "Workbook not found" }, 404)
    const notes = await loadNotes(supabase, workbookId)
    const authors = await authorNames([scope.actorId, ...notes.map((n) => n.coach_profile_id)])
    return withCorsJson(req, { ok: true, notes, authors, me: scope.actorId, realtime_filter: `workbook_id=eq.${workbookId}` }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ clientId: string; workbookId: string }> }) {
  try {
    const { clientId, workbookId } = await params
    const { supabase, scope } = await coachWorkbookScope(req, clientId)
    const b = await req.json().catch(() => ({}))
    const wb = await readWorkbook(supabase, workbookId, scope.subjectId)
    if (!wb) return withCorsJson(req, { ok: false, error: "Workbook not found" }, 404)
    if (b.section_id === GENERAL_SECTION_ID) return withCorsJson(req, { ok: false, error: "Notes go on a section" }, 400)
    const bad = anchorError(wb.content, b.section_id, null)
    if (bad) return withCorsJson(req, { ok: false, error: bad }, 400)
    const body = typeof b.body === "string" ? b.body : ""
    if (!body.trim()) return withCorsJson(req, { ok: false, error: "Write something first" }, 400)
    if (body.length > NOTE_MAX) return withCorsJson(req, { ok: false, error: "That note is too long" }, 400)

    const note = must(
      await supabase.from("workbook_coach_notes").insert({
        workbook_id: workbookId, section_id: b.section_id, coach_profile_id: scope.actorId, body,
      }).select(NOTE_COLUMNS).single(),
      "save note",
    )
    return withCorsJson(req, { ok: true, note }, 201)
  } catch (err) {
    return workbookError(req, err)
  }
}
