// app/api/coach/coach-clients/[id]/engagements/[engagement_id]/sow/route.ts
//
// One client's SOW for one attached package.
//
//   GET  the coach's settings (saved, or the defaults: the package total and
//        the package's default payment terms), the built SOW and any warnings.
//        Reading never writes: an unsaved SOW is shown from its defaults.
//   PUT  { opening, price_override_cents, payment } saves the settings.
//        Amounts are in cents. Only while the package is a proposal.
//
// The rules are in lib/sow/client.ts and lib/sow/build.ts.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../_lib/cors"
import { getSupabaseAdmin, resolveCoach, errStatus, isCoachClientOwnedByCoach } from "../../../../../../_lib/coachEngagements"
import { getClientSow, saveClientSow } from "@/lib/sow/client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(
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
    const r = await getClientSow(db, id, engagement_id)
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, sow: r.data })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}

export async function PUT(
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
    const r = await saveClientSow(db, { coachClientId: id, engagementId: engagement_id, input: body, actor: coachProfileId })
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, sow: r.data })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
