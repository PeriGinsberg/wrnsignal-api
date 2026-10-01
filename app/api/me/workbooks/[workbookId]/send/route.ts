// app/api/me/workbooks/[workbookId]/send/route.ts
// POST — "Send to your coach". Partial is fine and it can be sent again.
// workbook_send_to_coach() releases the client's question drafts, sets status
// with_coach, and creates (or refreshes) one action-item note for the coach;
// this route gives that note its task, which is what reaches the dashboard.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { workbookError } from "../../../../_lib/workbookError"
import { logCoachClientEvent } from "../../../../_lib/coachClientEvents"
import { clientWorkbookScope, rpcError } from "@/lib/workbook/server"
import { getSupabaseAdmin } from "../../../../_lib/coachAuth"
import { ensureSystemNoteTask } from "@/lib/notes/actionItems"
import { workbookLink } from "@/lib/tasks/links"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest, { params }: { params: Promise<{ workbookId: string }> }) {
  try {
    const { workbookId } = await params
    const { supabase, actorId } = await clientWorkbookScope(req)
    const { data, error } = await supabase.rpc("workbook_send_to_coach", { p_workbook: workbookId })
    if (error) throw rpcError("send workbook", error)

    const r = data as { send_id?: string; coach_client_id?: string; open_questions?: number; title?: string }

    // THE COACH'S ACTION ITEM NEEDS ITS TASK. The RPC writes (or refreshes)
    // an action-item note, and since 2026-09-26 only tasks reach the
    // dashboard, so without this the coach was never told. Service role,
    // because the client's own JWT cannot write a coach's task. Never fails
    // the send: the workbook is with the coach either way.
    if (r?.send_id) {
      try {
        const admin = getSupabaseAdmin()
        const { data: send } = await admin.from("workbook_sends")
          .select("coach_note_id").eq("id", r.send_id).maybeSingle()
        const { data: wb } = await admin.from("workbooks")
          .select("client_profile_id").eq("id", workbookId).maybeSingle()
        if (send?.coach_note_id && wb?.client_profile_id) {
          const t = await ensureSystemNoteTask(admin, send.coach_note_id, {
            link: workbookLink(wb.client_profile_id, workbookId),
          })
          if (!t.ok) console.error("[workbooks/send] coach task not created:", t.error)
        }
      } catch (e: any) {
        console.error("[workbooks/send] coach task failed:", e?.message ?? e)
      }
    }

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
