// app/api/coach/my-recommendations/route.ts
// Client fetches coach recommendations targeted at them
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

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

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // Fetch all coach recommendations for this client
    const { data: recs, error: recErr } = await supabase
      .from("coach_job_recommendations")
      .select("*")
      .eq("client_profile_id", profileId)
      .order("created_at", { ascending: false })

    if (recErr) throw new Error(`Recommendations lookup failed: ${recErr.message}`)

    // Fetch coach names
    const coachIds = [...new Set((recs || []).map((r: any) => r.coach_profile_id).filter(Boolean))]
    let coachNames: Record<string, string> = {}
    if (coachIds.length > 0) {
      const { data: coaches } = await supabase
        .from("client_profiles")
        .select("id, name")
        .in("id", coachIds)
      for (const c of coaches || []) coachNames[c.id] = c.name || "Your Coach"
    }

    const recommendations = (recs || []).map((r: any) => ({
      ...r,
      coach_name: coachNames[r.coach_profile_id] || "Your Coach",
    }))

    return withCorsJson(req, { ok: true, recommendations })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.includes("Unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

// PATCH — bulk update: mark all 'new' as 'interested'
export async function PATCH(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const body = await req.json().catch(() => null)
    if (body?.action === "mark_all_seen") {
      const { error } = await supabase
        .from("coach_job_recommendations")
        .update({ client_status: "interested", updated_at: new Date().toISOString() })
        .eq("client_profile_id", profileId)
        .eq("client_status", "new")
      if (error) throw new Error(`Update failed: ${error.message}`)
      return withCorsJson(req, { ok: true })
    }

    return withCorsJson(req, { error: "Unknown action" }, 400)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.includes("Unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
