// app/api/coach/clients/[clientId]/workbooks/[workbookId]/evaluation/route.ts
// PUT { section_id, ratings, note } — the coach's saved rubric for one section.
// Checked against the rubric in the workbook content (evaluationError), so only
// the content's own item and scale keys are ever stored. Coach only: the client
// has no policy on workbook_evaluations and never sees it.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../_lib/cors"
import { workbookError } from "../../../../../../_lib/workbookError"
import { must } from "../../../../../../_lib/must"
import { coachWorkbookScope } from "@/lib/workbook/server"
import { evaluationError, type WorkbookContent } from "@/lib/workbook/content"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type P = { params: Promise<{ clientId: string; workbookId: string }> }

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function PUT(req: NextRequest, { params }: P) {
  try {
    const { clientId, workbookId } = await params
    const { supabase, scope } = await coachWorkbookScope(req, clientId)
    const b = await req.json().catch(() => null)

    const wb = must(
      await supabase.from("workbooks").select("id, content")
        .eq("id", workbookId).eq("client_profile_id", scope.subjectId).maybeSingle(),
      "read workbook",
    ) as { id: string; content: WorkbookContent } | null
    if (!wb) return withCorsJson(req, { ok: false, error: "Workbook not found" }, 404)

    const bad = evaluationError(wb.content, b)
    if (bad) return withCorsJson(req, { ok: false, error: bad }, 400)

    const ratings = Object.fromEntries(Object.entries(b.ratings as Record<string, { rating?: string | null; note?: string }>)
      .map(([k, v]) => [k, { rating: v.rating ?? null, ...(v.note?.trim() ? { note: v.note } : {}) }]))
    const row = must(
      await supabase.from("workbook_evaluations")
        .upsert({
          workbook_id: workbookId, section_id: b.section_id, ratings,
          note: typeof b.note === "string" && b.note.trim() ? b.note : null,
          updated_by: scope.actorId, updated_at: new Date().toISOString(),
        }, { onConflict: "workbook_id,section_id" })
        .select("section_id, ratings, note, updated_at").single(),
      "save evaluation",
    )
    return withCorsJson(req, { ok: true, evaluation: row }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
