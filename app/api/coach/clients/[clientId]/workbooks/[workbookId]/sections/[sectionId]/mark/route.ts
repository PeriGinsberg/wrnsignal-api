// app/api/coach/clients/[clientId]/workbooks/[workbookId]/sections/[sectionId]/mark/route.ts
// PUT { reviewed: boolean } — the coach's own per-section "Reviewed" marker.
// For the coach's tracking only; notifies nobody and the client never sees it.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../../../_lib/cors"
import { workbookError } from "../../../../../../../../_lib/workbookError"
import { must } from "../../../../../../../../_lib/must"
import { coachWorkbookScope } from "@/lib/workbook/server"
import type { WorkbookContent } from "@/lib/workbook/content"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type P = { params: Promise<{ clientId: string; workbookId: string; sectionId: string }> }

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function PUT(req: NextRequest, { params }: P) {
  try {
    const { clientId, workbookId, sectionId } = await params
    const { supabase, scope } = await coachWorkbookScope(req, clientId)
    const b = await req.json().catch(() => ({}))
    if (typeof b.reviewed !== "boolean") return withCorsJson(req, { ok: false, error: "reviewed must be true or false" }, 400)

    const wb = must(
      await supabase.from("workbooks").select("id, content")
        .eq("id", workbookId).eq("client_profile_id", scope.subjectId).maybeSingle(),
      "read workbook",
    ) as { id: string; content: WorkbookContent } | null
    if (!wb) return withCorsJson(req, { ok: false, error: "Workbook not found" }, 404)
    if (!wb.content.sections.some((s) => s.id === sectionId)) {
      return withCorsJson(req, { ok: false, error: "Unknown section" }, 400)
    }

    if (b.reviewed) {
      must(
        await supabase.from("workbook_section_marks")
          .upsert({ workbook_id: workbookId, section_id: sectionId, marked_by: scope.actorId },
            { onConflict: "workbook_id,section_id", ignoreDuplicates: true }),
        "mark section",
      )
    } else {
      must(
        await supabase.from("workbook_section_marks").delete()
          .eq("workbook_id", workbookId).eq("section_id", sectionId),
        "unmark section",
      )
    }
    return withCorsJson(req, { ok: true, reviewed: b.reviewed }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
