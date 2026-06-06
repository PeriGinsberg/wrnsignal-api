// app/api/coach/coach-clients/[id]/engagements/route.ts
//
// Client Engagements — list / attach. Keyed by coach_clients.id ([id]).
//
//   GET  — list this client relationship's engagements, each with its frozen
//          deliverables[] (+ nested activities[]) and pricing.
//   POST — { package_id } → snapshot that package as a new engagement via the
//          attach_package_to_engagement RPC (all-or-nothing). 201 on success.
//
// SECURITY: the coach_clients row [id] must belong to the authed coach (→ 404).
// The RPC re-gates BOTH the relationship and the package ownership; its raised
// exceptions are mapped to a clean 404 (never leak the raw Postgres error).

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  UUID_RE,
  isCoachClientOwnedByCoach,
  listApiEngagements,
  getApiEngagementById,
} from "../../../../_lib/coachEngagements"
import { logCoachClientEvent } from "../../../../_lib/coachClientEvents"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── GET: list this relationship's engagements (snapshot + pricing) ──
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(supabase, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }

    const engagements = await listApiEngagements(supabase, id)
    return withCorsJson(req, { ok: true, engagements })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

// ── POST: attach a package as a frozen engagement (via the RPC) ──
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }
    const packageId = typeof body.package_id === "string" ? body.package_id : ""
    if (!UUID_RE.test(packageId)) {
      return withCorsJson(req, { ok: false, error: "package_id must be a package UUID" }, 400)
    }

    const supabase = getSupabaseAdmin()
    // Route-level ownership of the relationship (clean 404 before touching the RPC).
    if (!(await isCoachClientOwnedByCoach(supabase, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }

    // The RPC does its own dual-ownership gate (relationship AND package) and
    // snapshots everything atomically. Map its raised exceptions to a 404.
    const { data: newEngagementId, error: rpcErr } = await supabase.rpc("attach_package_to_engagement", {
      p_coach_client_id: id,
      p_package_id: packageId,
      p_coach_profile_id: coachProfileId,
    })
    if (rpcErr) {
      const msg = rpcErr.message || ""
      if (/package_not_found_or_wrong_coach|coach_client_not_found_or_wrong_coach/.test(msg)) {
        return withCorsJson(req, { ok: false, error: "Package or client relationship not found" }, 404)
      }
      return withCorsJson(req, { ok: false, error: `Failed to attach package: ${msg}` }, 500)
    }

    const engagement = await getApiEngagementById(supabase, id, newEngagementId as string)

    // Best-effort event log (after the snapshot landed).
    await logCoachClientEvent({
      coachClientId: id,
      eventType: "engagement_attached",
      actorProfileId: coachProfileId,
      context: { name: engagement?.name, engagement_id: newEngagementId },
    })

    return withCorsJson(req, { ok: true, engagement }, 201)
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
