// app/api/coach/coach-clients/[id]/messages/route.ts
//
// The Message panel on a client or prospect record.
//
//   GET   what the panel shows before the coach types: To, the parent (for the
//         optional CC), whether there is a phone number (SMS, coming soon),
//         the coach's sending address and signature.
//   POST  { channel: "email", subject, body, cc_parent } sends it.
//
// From, To and the copies are worked out on the server from the record and the
// signed-in coach's settings; nothing the browser sends can change them. The
// rules are in lib/messaging/sendCoachMessage.ts. Auth and ownership are the
// Communications tab's (../emails/route.ts).

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { getSupabaseAdmin, resolveCoach, errStatus, isCoachClientOwnedByCoach } from "../../../../_lib/coachEngagements"
import { getMessageContext, sendCoachMessage } from "@/lib/messaging/sendCoachMessage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error
    const db = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(db, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }
    const ctx = await getMessageContext(db, id, coachProfileId)
    if (!ctx) return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    // Which provider carries the mail is the server's business.
    const context: Omit<typeof ctx, "provider"> & { provider?: string } = { ...ctx }
    delete context.provider
    return withCorsJson(req, { ok: true, context })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error
    const db = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(db, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }
    const r = await sendCoachMessage(db, {
      coachClientId: id,
      actor: coachProfileId,
      input: await req.json().catch(() => ({})),
    })
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, ...r.data })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
