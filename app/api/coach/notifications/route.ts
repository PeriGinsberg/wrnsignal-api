// app/api/coach/notifications/route.ts
// Client-facing: returns unseen recommendations and annotation counts for the current user.
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

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

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // Unseen coach job recommendations for this client
    const { data: unseenRecs, error: recsErr } = await supabase
      .from("coach_job_recommendations")
      .select("id, coach_profile_id, job_title, company_name, jobfit_decision, jobfit_score, coach_note, created_at, notification_seen")
      .eq("client_profile_id", profileId)
      .eq("notification_seen", false)
      .order("created_at", { ascending: false })

    if (recsErr) throw new Error(`Failed to fetch recommendations: ${recsErr.message}`)

    // Annotation count on client's applications (all time, for badge display)
    const { count: annotationCount } = await supabase
      .from("coach_annotations")
      .select("id", { count: "exact", head: true })
      .eq("client_profile_id", profileId)

    // Enrich with coach name
    const coachIds = [...new Set((unseenRecs || []).map((r: any) => r.coach_profile_id))]
    let coachNames: Record<string, string> = {}
    if (coachIds.length > 0) {
      const { data: coaches } = await supabase
        .from("client_profiles")
        .select("id, name, coach_org")
        .in("id", coachIds)
      for (const c of coaches || []) {
        coachNames[c.id] = c.name || c.coach_org || "Your coach"
      }
    }

    const recommendations = (unseenRecs || []).map((r: any) => ({
      ...r,
      coach_name: coachNames[r.coach_profile_id] || null,
    }))

    return withCorsJson(req, {
      ok: true,
      unseen_recommendation_count: recommendations.length,
      recommendations,
      annotation_count: annotationCount || 0,
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
