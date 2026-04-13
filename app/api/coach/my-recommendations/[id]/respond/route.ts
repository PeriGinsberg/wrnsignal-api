// app/api/coach/my-recommendations/[id]/respond/route.ts
// Client responds to a coach recommendation (applying, not_for_me, etc.)
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim() || null
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  if (!token) throw new Error("Unauthorized: missing bearer token")
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return { userId: data.user.id, email: (data.user.email ?? "").trim().toLowerCase() || null }
}

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase.from("client_profiles").select("id").eq("user_id", userId).maybeSingle()
  if (data) return data.id as string
  if (email) {
    const { data: byEmail } = await supabase.from("client_profiles").select("id").eq("email", email).maybeSingle()
    if (byEmail) return byEmail.id as string
  }
  throw new Error("Profile not found")
}

const VALID_STATUSES = ["interested", "applying", "applied", "not_for_me"]

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: recId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // Verify this recommendation belongs to this client
    const { data: rec, error: recErr } = await supabase
      .from("coach_job_recommendations")
      .select("id, client_profile_id, application_id")
      .eq("id", recId)
      .single()

    if (recErr || !rec) return withCorsJson(req, { error: "Recommendation not found" }, 404)
    if (rec.client_profile_id !== profileId) return withCorsJson(req, { error: "Forbidden" }, 403)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") return withCorsJson(req, { error: "Invalid body" }, 400)

    const clientStatus = String(body.client_status || "").trim()
    if (!VALID_STATUSES.includes(clientStatus)) {
      return withCorsJson(req, { error: `Invalid client_status. Must be one of: ${VALID_STATUSES.join(", ")}` }, 400)
    }

    const { error: updateErr } = await supabase
      .from("coach_job_recommendations")
      .update({ client_status: clientStatus, updated_at: new Date().toISOString() })
      .eq("id", recId)

    if (updateErr) throw new Error(`Update failed: ${updateErr.message}`)

    // If applying, also update the linked application status
    if (clientStatus === "applying" && rec.application_id) {
      await supabase
        .from("signal_applications")
        .update({ application_status: "applied", updated_at: new Date().toISOString() })
        .eq("id", rec.application_id)
    }

    return withCorsJson(req, { ok: true, client_status: clientStatus })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.includes("Unauthorized") ? 401 : msg.includes("Forbidden") ? 403 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
