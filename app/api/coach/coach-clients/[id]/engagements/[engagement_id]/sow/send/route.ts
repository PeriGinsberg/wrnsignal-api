// app/api/coach/coach-clients/[id]/engagements/[engagement_id]/sow/send/route.ts
//
// POST { subject, body, cc_parent } sends the client their SOW: freezes it,
// makes a new private link, withdraws any other SOW that is out for this
// client, emails it, and records it. See lib/sow/send.ts for the order and
// for what happens when the email fails.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../../_lib/cors"
import { getSupabaseAdmin, resolveCoach, errStatus, isCoachClientOwnedByCoach } from "../../../../../../../_lib/coachEngagements"
import { resolveDelegation } from "@/lib/collab/delegation"
import { getAppUrl } from "@/lib/urls"
import { getClientSow } from "@/lib/sow/client"
import { sendClientSow } from "@/lib/sow/send"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; engagement_id: string }> },
) {
  try {
    const { id, engagement_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error
    const db = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(db, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }
    const body = await req.json().catch(() => ({}))
    const r = await sendClientSow(db, {
      coachClientId: id,
      engagementId: engagement_id,
      actingIds: (await resolveDelegation(db, coachProfileId)).actingIds,
      actor: coachProfileId,
      subject: body?.subject,
      body: body?.body,
      ccParent: body?.cc_parent,
      appUrl: getAppUrl(req),
    })
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    const sow = await getClientSow(db, id, engagement_id)
    return withCorsJson(req, { ok: true, sent: r.data, sow: sow.ok ? sow.data : null })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
