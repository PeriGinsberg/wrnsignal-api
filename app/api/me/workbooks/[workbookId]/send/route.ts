// app/api/me/workbooks/[workbookId]/send/route.ts
// POST — "Send to your coach". Partial is fine and it can be sent again.
// workbook_send_to_coach() releases the client's question drafts, sets status
// with_coach, and creates (or refreshes) one Required Actions row for the coach.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { workbookError } from "../../../../_lib/workbookError"
import { logCoachClientEvent } from "../../../../_lib/coachClientEvents"
import { clientWorkbookScope, rpcError } from "@/lib/workbook/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest, { params }: { params: Promise<{ workbookId: string }> }) {
  try {
    const { workbookId } = await params
    const { supabase, actorId } = await clientWorkbookScope(req)
    const { data, error } = await supabase.rpc("workbook_send_to_coach", { p_workbook: workbookId })
    if (error) throw rpcError("send workbook", error)

    const r = data as { coach_client_id?: string; open_questions?: number; title?: string }
    if (r?.coach_client_id) {
      await logCoachClientEvent({
        coachClientId: r.coach_client_id,
        eventType: "workbook_sent_for_review",
        actorProfileId: actorId,
        context: { title: r.title ?? null, open_questions: r.open_questions ?? 0 },
      })
    }
    return withCorsJson(req, { ok: true, ...(data as object) }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
