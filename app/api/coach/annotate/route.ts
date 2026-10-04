// app/api/coach/annotate/route.ts
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
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
  const { data } = await supabase
    .from("coach_clients")
    .select("id, access_level, status")
    .in("coach_profile_id", (await resolveDelegation(supabase, coachProfileId)).actingIds)
    .eq("client_profile_id", clientProfileId)
    .eq("status", "active")
    .maybeSingle()
  if (!data) return null
  if (!levels[requiredLevel]?.includes(data.access_level)) return null
  return data
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const applicationId = String(body.application_id || "").trim()
    const clientProfileId = String(body.client_profile_id || "").trim()
    const note = String(body.note || "").trim()

    if (!applicationId) return withCorsJson(req, { ok: false, error: "application_id is required" }, 400)
    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "client_profile_id is required" }, 400)
    if (!note) return withCorsJson(req, { ok: false, error: "note is required" }, 400)

    const access = await verifyCoachAccess(profileId, clientProfileId, "annotate", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: annotate access required" }, 403)
    }

    // Verify the application belongs to the client
    const { data: app } = await supabase
      .from("signal_applications")
      .select("id, profile_id")
      .eq("id", applicationId)
      .eq("profile_id", clientProfileId)
      .maybeSingle()

    if (!app) {
      return withCorsJson(req, { ok: false, error: "Application not found or does not belong to this client" }, 404)
    }

    // Insert shape matches the columns declared in
    // supabase/migrations/20260413_coach_client_system.sql:114-136
    // and the read filter at app/api/coach/clients/[clientId]/tracker/
    // route.ts:117-124 (target_type = "application" AND target_id IN
    // (...) AND coach_profile_id = ...). Prior version wrote to
    // application_id + annotation_type, which DO NOT EXIST on the
    // table — every save silently 500'd. See
    // docs/coach-note-save-bug-investigation-2026-05-19.md for the
    // full diagnostic trace.
    const { data: annotation, error: annErr } = await supabase
      .from("coach_annotations")
      .insert({
        coach_profile_id: profileId,
        client_profile_id: clientProfileId,
        target_type: "application",
        target_id: applicationId,
        note,
        priority: body.priority || "info",
        visible_to_client: body.visible_to_client !== false,
      })
      .select("*")
      .single()

    if (annErr) throw new Error(`Failed to create annotation: ${annErr.message}`)

    return withCorsJson(req, { ok: true, annotation }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = errorStatus(msg)
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
