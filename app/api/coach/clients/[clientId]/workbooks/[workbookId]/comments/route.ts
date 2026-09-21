// app/api/coach/clients/[clientId]/workbooks/[workbookId]/comments/route.ts
// POST a coach draft: a comment, a suggested edit, or an answer to a client
// question. Drafts stay invisible to the client until Send back releases them
// (released_at is set only by workbook_send_to_client).

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../_lib/cors"
import { workbookError } from "../../../../../../_lib/workbookError"
import { must } from "../../../../../../_lib/must"
import { COMMENT_COLUMNS, coachWorkbookScope } from "@/lib/workbook/server"
import { anchorError, validateAnswerValue, type WorkbookContent } from "@/lib/workbook/content"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const KINDS = new Set(["coach_comment", "coach_suggestion", "coach_answer"])

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest, { params }: { params: Promise<{ clientId: string; workbookId: string }> }) {
  try {
    const { clientId, workbookId } = await params
    const { supabase, scope } = await coachWorkbookScope(req, clientId)
    const b = await req.json().catch(() => ({}))

    const wb = must(
      await supabase.from("workbooks").select("id, content")
        .eq("id", workbookId).eq("client_profile_id", scope.subjectId).maybeSingle(),
      "read workbook",
    ) as { id: string; content: WorkbookContent } | null
    if (!wb) return withCorsJson(req, { ok: false, error: "Workbook not found" }, 404)

    const kind = b.kind
    if (!KINDS.has(kind)) return withCorsJson(req, { ok: false, error: "Unknown kind" }, 400)

    let sectionId = b.section_id
    let fieldKey = b.field_key ?? null
    let parentId: string | null = null

    if (kind === "coach_answer") {
      // An answer hangs off a released client question and shares its anchor.
      const q = must(
        await supabase.from("workbook_comments").select("id, section_id, field_key, kind, released_at")
          .eq("id", b.parent_id ?? "").eq("workbook_id", workbookId).maybeSingle(),
        "read question",
      ) as any
      if (!q || q.kind !== "client_question" || !q.released_at) {
        return withCorsJson(req, { ok: false, error: "Answer must reply to a client question" }, 400)
      }
      parentId = q.id
      sectionId = q.section_id
      fieldKey = q.field_key
    } else {
      const bad = anchorError(wb.content, sectionId, fieldKey)
      if (bad) return withCorsJson(req, { ok: false, error: bad }, 400)
    }

    const body = typeof b.body === "string" ? b.body.trim() : ""
    let suggested: unknown = null
    if (kind === "coach_suggestion") {
      if (!fieldKey) return withCorsJson(req, { ok: false, error: "A suggested edit needs a field" }, 400)
      const bad = validateAnswerValue(wb.content, fieldKey, b.suggested_value)
      if (bad) return withCorsJson(req, { ok: false, error: bad }, 400)
      suggested = b.suggested_value
    } else if (!body) {
      return withCorsJson(req, { ok: false, error: "Write something first" }, 400)
    }

    const row = must(
      await supabase.from("workbook_comments").insert({
        workbook_id: workbookId,
        section_id: sectionId,
        field_key: fieldKey,
        kind,
        parent_id: parentId,
        body,
        suggested_value: suggested,
        suggestion_status: kind === "coach_suggestion" ? "pending" : null,
        author_role: "coach",
        author_id: scope.actorId,
      }).select(COMMENT_COLUMNS).single(),
      "save draft",
    )

    return withCorsJson(req, { ok: true, comment: row }, 201)
  } catch (err) {
    return workbookError(req, err)
  }
}
