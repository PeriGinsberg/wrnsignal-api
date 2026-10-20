// app/api/webhooks/postmark/route.ts
//
// POST: Postmark's delivery / bounce / spam-complaint webhook for the coach
// message stream. Registered by tests/messaging/setup-coach-stream.ts. What a
// delivery does is in lib/messaging/postmarkWebhook.ts.
//
// Every request must carry Basic auth with POSTMARK_WEBHOOK_SECRET as the
// password.

import { type NextRequest } from "next/server"
import { getSupabaseAdmin } from "../../_lib/coachAuth"
import { checkBasicAuth, handlePostmarkEvent, type PostmarkEvent } from "@/lib/messaging/postmarkWebhook"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const secret = process.env.POSTMARK_WEBHOOK_SECRET
  if (!secret) {
    console.error("[postmark-webhook] POSTMARK_WEBHOOK_SECRET is not set")
    return Response.json({ ok: false, error: "Not configured" }, { status: 503 })
  }
  if (!checkBasicAuth(req.headers.get("authorization"), secret)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }
  let ev: PostmarkEvent
  try {
    ev = await req.json()
  } catch {
    return Response.json({ ok: false, error: "Bad JSON" }, { status: 400 })
  }
  const r = await handlePostmarkEvent(getSupabaseAdmin(), ev)
  if (r.status >= 500) console.error(`[postmark-webhook] ${ev.RecordType} ${ev.MessageID}: ${r.outcome}`)
  return Response.json({ ok: r.status < 400, outcome: r.outcome }, { status: r.status })
}
