// app/api/coach/clients/[clientId]/workbooks/[workbookId]/comments/[commentId]/route.ts
// PATCH or DELETE one of the coach's own DRAFTS. Released items are final: the
// draft policies match only released_at IS NULL rows by their author, so a
// released or someone else's comment updates zero rows and answers 404.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../../_lib/cors"
import { workbookError } from "../../../../../../../_lib/workbookError"
import { must } from "../../../../../../../_lib/must"
import { COMMENT_COLUMNS, coachWorkbookScope } from "@/lib/workbook/server"
import { validateAnswerValue, type WorkbookContent } from "@/lib/workbook/content"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type P = { params: Promise<{ clientId: string; workbookId: string; commentId: string }> }

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function PATCH(req: NextRequest, { params }: P) {
  try {
    const { clientId, workbookId, commentId } = await params
    const { supabase, scope } = await coachWorkbookScope(req, clientId)
    const b = await req.json().catch(() => ({}))

    const current = must(
      await supabase.from("workbook_comments").select("id, kind, field_key, body, workbooks!inner(content, client_profile_id)")
        .eq("id", commentId).eq("workbook_id", workbookId)
        .eq("workbooks.client_profile_id", scope.subjectId).maybeSingle(),
      "read draft",
    ) as any
    if (!current) return withCorsJson(req, { ok: false, error: "Draft not found" }, 404)

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof b.body === "string") patch.body = b.body.trim()
    if (b.suggested_value !== undefined) {
      if (current.kind !== "coach_suggestion") return withCorsJson(req, { ok: false, error: "Only a suggested edit has a value" }, 400)
      const bad = validateAnswerValue(current.workbooks.content as WorkbookContent, current.field_key, b.suggested_value)
      if (bad) return withCorsJson(req, { ok: false, error: bad }, 400)
      patch.suggested_value = b.suggested_value
    }
    if (current.kind !== "coach_suggestion" && patch.body === "") {
      return withCorsJson(req, { ok: false, error: "Write something first, or delete the draft" }, 400)
    }

    const rows = must(
      await supabase.from("workbook_comments").update(patch)
        .eq("id", commentId).is("released_at", null).select(COMMENT_COLUMNS),
      "update draft",
    ) ?? []
    if (!rows.length) return withCorsJson(req, { ok: false, error: "Draft not found. It may already have been sent." }, 404)
    return withCorsJson(req, { ok: true, comment: rows[0] }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}

export async function DELETE(req: NextRequest, { params }: P) {
  try {
    const { clientId, workbookId, commentId } = await params
    const { supabase, scope } = await coachWorkbookScope(req, clientId)

    const wb = must(
      await supabase.from("workbooks").select("id")
        .eq("id", workbookId).eq("client_profile_id", scope.subjectId).maybeSingle(),
      "read workbook",
    )
    if (!wb) return withCorsJson(req, { ok: false, error: "Workbook not found" }, 404)

    const rows = must(
      await supabase.from("workbook_comments").delete()
        .eq("id", commentId).eq("workbook_id", workbookId).is("released_at", null)
        .select("id"),
      "delete draft",
    ) ?? []
    if (!rows.length) return withCorsJson(req, { ok: false, error: "Draft not found. It may already have been sent." }, 404)
    return withCorsJson(req, { ok: true }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
