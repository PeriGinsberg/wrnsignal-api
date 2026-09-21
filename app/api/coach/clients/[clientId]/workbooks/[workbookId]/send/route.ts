// app/api/coach/clients/[clientId]/workbooks/[workbookId]/send/route.ts
// POST — "Send to <client>" (first share of a draft) and every "Send back".
// workbook_send_to_client() releases all coach drafts, sets status
// with_client, completes the open Required Actions row and records the send,
// in one transaction. The Coaches Hub item comes from that send row.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../_lib/cors"
import { workbookError } from "../../../../../../_lib/workbookError"
import { must } from "../../../../../../_lib/must"
import { coachWorkbookScope, rpcError } from "@/lib/workbook/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest, { params }: { params: Promise<{ clientId: string; workbookId: string }> }) {
  try {
    const { clientId, workbookId } = await params
    const { supabase, scope } = await coachWorkbookScope(req, clientId)

    const wb = must(
      await supabase.from("workbooks").select("id")
        .eq("id", workbookId).eq("client_profile_id", scope.subjectId).maybeSingle(),
      "read workbook",
    )
    if (!wb) return withCorsJson(req, { ok: false, error: "Workbook not found" }, 404)

    const { data, error } = await supabase.rpc("workbook_send_to_client", { p_workbook: workbookId })
    if (error) throw rpcError("send workbook", error)
    return withCorsJson(req, { ok: true, ...(data as object) }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
