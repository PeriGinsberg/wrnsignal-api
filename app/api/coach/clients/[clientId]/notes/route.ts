// app/api/coach/clients/[clientId]/notes/route.ts
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { resolveDelegation } from "@/lib/collab/delegation"
import { getAuthedUser, getProfileId } from "@/lib/collab/identity"
import { errorStatus } from "@/app/api/_lib/routeError"


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function verifyCoachAccess(coachProfileId: string, clientProfileId: string, requiredLevel: string, supabase: any) {
  const levels: Record<string, string[]> = { view: ["view", "annotate", "full"], annotate: ["annotate", "full"], full: ["full"] }
  // A DELEGATE coach acts inside a principal's practice, so the row that grants
  // access may belong to the principal rather than the caller. Match any coach
  // this caller may act as and keep the strongest row; a delegation can only add
  // access, never lower what the caller already held in their own right.
  const { actingIds } = await resolveDelegation(supabase, coachProfileId)
  const { data, error } = await supabase
    .from("coach_clients")
    .select("id, access_level, status, coach_profile_id")
    .in("coach_profile_id", actingIds)
    .eq("client_profile_id", clientProfileId)
    .eq("status", "active")
  if (error) throw new Error(`coach_clients lookup failed: ${error.message}`)
  const rank: Record<string, number> = { view: 1, annotate: 2, full: 3 }
  const granted = (data ?? [])
    .filter((r: any) => levels[requiredLevel]?.includes(r.access_level))
    .sort((a: any, b: any) => rank[b.access_level] - rank[a.access_level])[0]
  return granted ?? null
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId: clientProfileId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "clientId is required" }, 400)

    const access = await verifyCoachAccess(profileId, clientProfileId, "view", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    if (body.private_notes === undefined) {
      return withCorsJson(req, { ok: false, error: "private_notes is required" }, 400)
    }

    const { data, error: updateErr } = await supabase
      .from("coach_clients")
      .update({ private_notes: body.private_notes })
      .eq("id", access.id)
      .select("id, private_notes")
      .single()

    if (updateErr) throw new Error(`Failed to update notes: ${updateErr.message}`)

    return withCorsJson(req, { ok: true, relationship_id: data.id, private_notes: data.private_notes })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = errorStatus(msg)
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
