// app/api/me/workbooks/[workbookId]/suggestions/[commentId]/route.ts
// POST { action: "accept" | "keep_own" } on a released suggested edit.
// Accept writes the suggested value into the answer (history source
// 'accepted_suggestion') and marks the suggestion, in one transaction.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { workbookError } from "../../../../../_lib/workbookError"
import { must } from "../../../../../_lib/must"
import { clientWorkbookScope, rpcError } from "@/lib/workbook/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type P = { params: Promise<{ workbookId: string; commentId: string }> }

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest, { params }: P) {
  try {
    const { workbookId, commentId } = await params
    const { supabase } = await clientWorkbookScope(req)
    const b = await req.json().catch(() => ({}))
    if (b.action !== "accept" && b.action !== "keep_own") {
      return withCorsJson(req, { ok: false, error: "action must be accept or keep_own" }, 400)
    }

    // The suggestion must belong to this workbook; RLS already limits it to the caller's.
    const found = must(
      await supabase.from("workbook_comments").select("id")
        .eq("id", commentId).eq("workbook_id", workbookId).eq("kind", "coach_suggestion").maybeSingle(),
      "read suggestion",
    )
    if (!found) return withCorsJson(req, { ok: false, error: "Suggestion not found" }, 404)

    const { data, error } = await supabase.rpc("workbook_resolve_suggestion", {
      p_comment: commentId,
      p_accept: b.action === "accept",
    })
    if (error) throw rpcError("resolve suggestion", error)
    return withCorsJson(req, { ok: true, ...(data as object) }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
