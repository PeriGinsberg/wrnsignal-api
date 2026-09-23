// app/api/me/workbooks/[workbookId]/homework-complete/route.ts
//
// POST — the client marks a session workbook's homework complete.
//
// TWO EFFECTS, IN THIS ORDER, AND ONLY THE FIRST IS GUARANTEED:
//   1. workbook_mark_homework_complete() stamps the workbook and raises the
//      coach's Required Actions item, in one transaction. It reports `fired`
//      true only for the call that actually set the timestamp, so a second press
//      (or a second tab) changes nothing.
//   2. On `fired`, and only then, this posts to GHL_HOMEWORK_WEBHOOK_URL.
//
// A webhook that is unset, slow or failing must not cost the client their
// completion, so a failure is logged and reported, never retried in a loop, and
// never rolls step 1 back. homework_webhook_at stays empty until a POST lands.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { workbookError } from "../../../../_lib/workbookError"
import { clientWorkbookScope, rpcError } from "@/lib/workbook/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const WEBHOOK_TIMEOUT_MS = 8000

/** "session-1-foundations" -> 1. Absent or unnumbered templates report null. */
function sessionNumber(templateId: string | null): number | null {
  const m = (templateId ?? "").match(/session-(\d+)/i)
  return m ? Number(m[1]) : null
}

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest, { params }: { params: Promise<{ workbookId: string }> }) {
  try {
    const { workbookId } = await params
    const { supabase } = await clientWorkbookScope(req)

    const { data, error } = await supabase.rpc("workbook_mark_homework_complete", { p_workbook: workbookId })
    if (error) throw rpcError("mark homework complete", error)
    const r = data as {
      fired: boolean; completed_at: string; webhook_sent_at: string | null
      email: string; first_name: string; last_name: string | null; template_id: string | null; title: string
    }

    let webhook: "sent" | "skipped" | "not_configured" | "failed" = r.fired ? "not_configured" : "skipped"
    const url = process.env.GHL_HOMEWORK_WEBHOOK_URL

    if (r.fired && url) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: r.email,
            first_name: r.first_name,
            last_name: r.last_name ?? "",
            session: sessionNumber(r.template_id) ?? 1,
            event: "homework_complete",
            workbook_id: workbookId,
          }),
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`webhook responded ${res.status}`)
        webhook = "sent"
        const { error: stampErr } = await supabase.rpc("workbook_record_homework_webhook", { p_workbook: workbookId })
        if (stampErr) console.error("[homework-complete] stamp failed:", stampErr.message)
      } catch (e: any) {
        // The completion stands; only the notification is missing.
        webhook = "failed"
        console.error("[homework-complete] webhook failed:", e?.message ?? e, "workbook:", workbookId)
      }
    }

    return withCorsJson(req, { ok: true, completed_at: r.completed_at, first_time: r.fired, webhook }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
