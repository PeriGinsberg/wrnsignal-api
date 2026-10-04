// app/api/coach/notifications/route.ts
// Client-facing: returns unseen recommendations and annotation counts for the current user.
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
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
      .select("id, coach_profile_id, job_title, company_name, signal_decision, signal_score, coaching_note, created_at, notification_seen")
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
    const status = errorStatus(msg)
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
