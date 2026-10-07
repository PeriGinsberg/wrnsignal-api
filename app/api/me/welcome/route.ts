// app/api/me/welcome/route.ts
//
// CLIENT-FACING read for the first-run welcome screen: who the client's coach
// is, and the phases in the client's plan. Same identity and gate as
// /api/me/activities (plain client, then the ACTIVE coach relationship). No
// active coach returns { coach: null, phases: [] }, not an error.
//
// Only phases IN the plan (an approved package has a needed deliverable in
// them), with label and status. Never task counts or coach internals. Read-only:
// the coach's default phases are not seeded from here.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getActiveCoachRelationship } from "../../_lib/coachedClient"
import { getAuthedUser, getProfileId, getSupabaseAdmin } from "@/lib/collab/identity"
import { getClientPhases } from "@/lib/phases/service"
import { errorStatus } from "@/app/api/_lib/routeError"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const rel = await getActiveCoachRelationship(supabase, profileId)
    if (!rel) return withCorsJson(req, { ok: true, coach: null, phases: [] })

    const { data: coach } = await supabase
      .from("client_profiles").select("name").eq("id", rel.coach_profile_id).maybeSingle()
    const name = ((coach as { name: string | null } | null)?.name ?? "").trim() || null

    const phases = ((await getClientPhases(supabase, rel.id, { seed: false })) ?? [])
      .filter((p) => p.status !== "not_in_plan")
      .map((p) => ({ phase_id: p.phase_id, label: p.label, status: p.status }))

    return withCorsJson(req, { ok: true, coach: { name }, phases })
  } catch (err: any) {
    const msg = err?.message || String(err)
    return withCorsJson(req, { ok: false, error: msg }, errorStatus(msg))
  }
}
