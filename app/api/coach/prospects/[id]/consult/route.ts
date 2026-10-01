// app/api/coach/prospects/[id]/consult/route.ts
//
// The consult screen's data (prospect workflow, Phase 1).
//
//   GET — everything the screen shows: the prospect's known fields (top,
//         editable), the consult's own fields (below), the coach's packages
//         for the Consult complete picker, and the chain each outcome runs.
//   PUT — save. Body: { prospect: {...}, consult: {...} }, any subset. The
//         consult becomes the record; the values it replaced go to History
//         (saveConsult, lib/prospects/workflow.ts).
//
// [id] is coach_clients.id. Booking and outcomes are ./booked and ./outcome.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { errStatus, getSupabaseAdmin, isCoachClientOwnedByCoach, resolveCoach } from "../../../../_lib/coachEngagements"
import { CONSULT_OUTCOME_CHAIN, CONSULT_PROSPECT_FIELDS, getConsult, saveConsult } from "@/lib/prospects/workflow"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { coachProfileId, delegation, error } = await resolveCoach(req)
    if (error) return error
    const db = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(db, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Prospect not found" }, 404)
    }

    const { data: prospect, error: pErr } = await db.from("coach_clients")
      .select(["id", "lifecycle_status", "prospect_status", "coach_profile_id", ...CONSULT_PROSPECT_FIELDS].join(", "))
      .eq("id", id).maybeSingle()
    if (pErr) throw new Error(`Failed to read prospect: ${pErr.message}`)
    if (!prospect) return withCorsJson(req, { ok: false, error: "Prospect not found" }, 404)

    const consult = await getConsult(db, id)

    // The practice's packages, for the Consult complete picker. Inactive ones
    // are left out: they are retired from the catalog.
    const { data: packages, error: pkgErr } = await db.from("coach_packages")
      .select("id, name, sort_order")
      .in("coach_profile_id", delegation.actingIds)
      .eq("active", true)
      .order("sort_order", { ascending: true })
    if (pkgErr) throw new Error(`Failed to read packages: ${pkgErr.message}`)

    return withCorsJson(req, {
      ok: true,
      prospect,
      consult,
      packages: (packages ?? []).map((p: any) => ({ id: p.id, name: p.name })),
      outcome_chain: CONSULT_OUTCOME_CHAIN,
    })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error
    const db = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(db, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Prospect not found" }, 404)
    }
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }
    const r = await saveConsult(db, { coachClientId: id, body, actor: coachProfileId })
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, changed: r.data.changed, consult: await getConsult(db, id) })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
