// app/api/me/workbooks/[workbookId]/route.ts
// GET the caller's workbook: content with coach_only removed IN THE DATABASE
// (workbook_for_client), their answers, their own question drafts plus every
// released coach item, and the send history. RLS scopes all of it.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { workbookError } from "../../../_lib/workbookError"
import { clientWorkbookScope, loadAnswers, loadComments, loadSends, rpcError } from "@/lib/workbook/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest, { params }: { params: Promise<{ workbookId: string }> }) {
  try {
    const { workbookId } = await params
    const { supabase, actorId } = await clientWorkbookScope(req)

    const { data: wb, error } = await supabase.rpc("workbook_for_client", { p_workbook: workbookId })
    if (error) throw rpcError("read workbook", error)
    if (!wb) return withCorsJson(req, { ok: false, error: "Workbook not found" }, 404)

    const [answers, comments, sends] = await Promise.all([
      loadAnswers(supabase, workbookId),
      loadComments(supabase, workbookId),
      loadSends(supabase, workbookId),
    ])

    return withCorsJson(req, { ok: true, me: actorId, workbook: wb, answers, comments, sends }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
