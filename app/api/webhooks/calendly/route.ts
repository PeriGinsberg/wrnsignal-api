// app/api/webhooks/calendly/route.ts
//
// POST — Calendly's booking webhook (invitee.created, invitee.canceled).
// Registered once per environment by scripts/calendly-setup.ts. Production
// only: real bookings never reach dev or staging, which test with
// tests/calendly/simulate.ts instead.
//
// Every request must carry Calendly's signature, made with the signing key in
// CALENDLY_WEBHOOK_SIGNING_KEY. What a delivery does is in lib/calendly/webhook.ts.

import { type NextRequest } from "next/server"
import { getSupabaseAdmin } from "../../_lib/coachAuth"
import { SIGNATURE_HEADER, handleCalendlyWebhook, verifyCalendlySignature, type CalendlyWebhook } from "@/lib/calendly/webhook"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const key = process.env.CALENDLY_WEBHOOK_SIGNING_KEY
  if (!key) {
    console.error("[calendly] CALENDLY_WEBHOOK_SIGNING_KEY is not set")
    return Response.json({ ok: false, error: "Not configured" }, { status: 503 })
  }
  const raw = await req.text()
  if (!verifyCalendlySignature(raw, req.headers.get(SIGNATURE_HEADER), key)) {
    return Response.json({ ok: false, error: "Bad signature" }, { status: 401 })
  }
  let body: CalendlyWebhook
  try {
    body = JSON.parse(raw)
  } catch {
    return Response.json({ ok: false, error: "Bad JSON" }, { status: 400 })
  }
  const r = await handleCalendlyWebhook(getSupabaseAdmin(), body)
  if (r.status >= 500) console.error(`[calendly] ${body.event} ${body.payload?.uri}: ${r.detail}`)
  return Response.json({ ok: r.status < 400, outcome: r.outcome, detail: r.detail ?? null }, { status: r.status })
}
