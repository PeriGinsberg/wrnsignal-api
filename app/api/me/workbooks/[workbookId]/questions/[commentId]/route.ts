// app/api/me/workbooks/[workbookId]/questions/[commentId]/route.ts
// PATCH { body } or DELETE one of the client's own unsent question drafts.
// Sent questions are final; the draft policies make those zero-row writes.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { workbookError } from "../../../../../_lib/workbookError"
import { must } from "../../../../../_lib/must"
import { COMMENT_COLUMNS, clientWorkbookScope } from "@/lib/workbook/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type P = { params: Promise<{ workbookId: string; commentId: string }> }

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function PATCH(req: NextRequest, { params }: P) {
  try {
    const { workbookId, commentId } = await params
    const { supabase } = await clientWorkbookScope(req)
    const b = await req.json().catch(() => ({}))
    const body = typeof b.body === "string" ? b.body.trim() : ""
    if (!body) return withCorsJson(req, { ok: false, error: "Write your question first, or delete it" }, 400)

    const rows = must(
      await supabase.from("workbook_comments")
        .update({ body, updated_at: new Date().toISOString() })
        .eq("id", commentId).eq("workbook_id", workbookId)
        .eq("kind", "client_question").is("released_at", null)
        .select(COMMENT_COLUMNS),
      "update question",
    ) ?? []
    if (!rows.length) return withCorsJson(req, { ok: false, error: "Question not found. It may already have been sent." }, 404)
    return withCorsJson(req, { ok: true, comment: rows[0] }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}

export async function DELETE(req: NextRequest, { params }: P) {
  try {
    const { workbookId, commentId } = await params
    const { supabase } = await clientWorkbookScope(req)
    const rows = must(
      await supabase.from("workbook_comments").delete()
        .eq("id", commentId).eq("workbook_id", workbookId)
        .eq("kind", "client_question").is("released_at", null)
        .select("id"),
      "delete question",
    ) ?? []
    if (!rows.length) return withCorsJson(req, { ok: false, error: "Question not found. It may already have been sent." }, 404)
    return withCorsJson(req, { ok: true }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
