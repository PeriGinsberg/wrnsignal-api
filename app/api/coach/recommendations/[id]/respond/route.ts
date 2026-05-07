// app/api/coach/recommendations/[id]/respond/route.ts
// Client-facing: client responds to a coach job recommendation.
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { logStatusChange } from "../../../../_lib/applicationStatusHistory"

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

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return {
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase() || null,
  }
}

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("client_profiles")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (data) return data.id as string

  if (email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("client_profiles")
      .select("id, user_id")
      .eq("email", email)
      .maybeSingle()
    if (emailErr) throw new Error(`Profile email lookup failed: ${emailErr.message}`)
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        const { error: attachErr } = await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
        if (attachErr) throw new Error(`Profile attach failed: ${attachErr.message}`)
      }
      return byEmail.id as string
    }
  }

  throw new Error("Profile not found")
}

const VALID_CLIENT_STATUSES = ["interested", "not_interested", "applying", "applied", "passed"]

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: recommendationId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!recommendationId) return withCorsJson(req, { ok: false, error: "id is required" }, 400)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const clientStatus = String(body.client_status || "").trim()
    if (!clientStatus) return withCorsJson(req, { ok: false, error: "client_status is required" }, 400)
    if (!VALID_CLIENT_STATUSES.includes(clientStatus)) {
      return withCorsJson(req, {
        ok: false,
        error: `client_status must be one of: ${VALID_CLIENT_STATUSES.join(", ")}`,
      }, 400)
    }

    // Verify the recommendation belongs to this client
    const { data: rec, error: recErr } = await supabase
      .from("coach_job_recommendations")
      .select("id, client_profile_id, application_id")
      .eq("id", recommendationId)
      .eq("client_profile_id", profileId)
      .maybeSingle()

    if (recErr) throw new Error(`Recommendation lookup failed: ${recErr.message}`)
    if (!rec) return withCorsJson(req, { ok: false, error: "Recommendation not found" }, 404)

    // Update recommendation
    const { data: updated, error: updateErr } = await supabase
      .from("coach_job_recommendations")
      .update({
        client_status: clientStatus,
        client_responded_at: new Date().toISOString(),
        notification_seen: true,
      })
      .eq("id", recommendationId)
      .select("*")
      .single()

    if (updateErr) throw new Error(`Failed to update recommendation: ${updateErr.message}`)

    // If client is applying or has applied, update the linked signal_applications row
    if (rec.application_id && ["applying", "applied"].includes(clientStatus)) {
      const newAppStatus = clientStatus === "applied" ? "applied" : "saved"
      // Capture pre-update status for the history log
      const { data: prev } = await supabase
        .from("signal_applications")
        .select("application_status")
        .eq("id", rec.application_id)
        .eq("profile_id", profileId)
        .maybeSingle()
      await supabase
        .from("signal_applications")
        .update({ application_status: newAppStatus })
        .eq("id", rec.application_id)
        .eq("profile_id", profileId)
      if (prev) {
        await logStatusChange(supabase, rec.application_id, prev.application_status, newAppStatus, profileId)
      }
    }

    return withCorsJson(req, { ok: true, recommendation: updated })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
