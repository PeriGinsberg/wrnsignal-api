// app/api/coach/clients/[clientId]/workbooks/[workbookId]/send/route.ts
// POST — "Send to <client>" (first share of a draft) and every "Send back".
// workbook_send_to_client() releases all coach drafts, sets status
// with_client, completes the open Required Actions row and records the send,
// in one transaction. The Coaches Hub item comes from that send row.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../_lib/cors"
import { workbookError } from "../../../../../../_lib/workbookError"
import { must } from "../../../../../../_lib/must"
import { logCoachClientEvent } from "../../../../../../_lib/coachClientEvents"
import { coachWorkbookScope, rpcError } from "@/lib/workbook/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest, { params }: { params: Promise<{ clientId: string; workbookId: string }> }) {
  try {
    const { clientId, workbookId } = await params
    const { supabase, scope } = await coachWorkbookScope(req, clientId)

    const wb = must(
      await supabase.from("workbooks").select("id, slug, title:content->>title")
        .eq("id", workbookId).eq("client_profile_id", scope.subjectId).maybeSingle(),
      "read workbook",
    )
    if (!wb) return withCorsJson(req, { ok: false, error: "Workbook not found" }, 404)

    // The same button means two different things. The first time it reaches the
    // client it is a share; every time after, it is the workbook coming back
    // with comments on it. Counted BEFORE the send, which adds a row.
    const priorSends = must(
      await supabase.from("workbook_sends").select("id")
        .eq("workbook_id", workbookId).eq("direction", "to_client"),
      "count previous sends",
    ) ?? []
    const firstShare = priorSends.length === 0

    const { data, error } = await supabase.rpc("workbook_send_to_client", { p_workbook: workbookId })
    if (error) throw rpcError("send workbook", error)

    if (scope.linkId) {
      await logCoachClientEvent({
        coachClientId: scope.linkId,
        eventType: firstShare ? "workbook_shared" : "workbook_returned",
        actorProfileId: scope.actorId,
        context: { title: wb.title ?? wb.slug, released: (data as any)?.released ?? 0 },
      })
    }
    return withCorsJson(req, { ok: true, ...(data as object) }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
