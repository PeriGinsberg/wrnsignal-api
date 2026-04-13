// app/api/coach/clients/[clientId]/tracker/route.ts
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"

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

async function verifyCoachAccess(coachProfileId: string, clientProfileId: string, requiredLevel: string, supabase: any) {
  const levels: Record<string, string[]> = { view: ["view", "annotate", "full"], annotate: ["annotate", "full"], full: ["full"] }
  const { data } = await supabase
    .from("coach_clients")
    .select("id, access_level, status")
    .eq("coach_profile_id", coachProfileId)
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

export async function GET(
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
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship with view access" }, 403)
    }

    // Fetch client applications
    const { data: applications, error: appsErr } = await supabase
      .from("signal_applications")
      .select("*, signal_interviews(id), client_personas(name)")
      .eq("profile_id", clientProfileId)
      .order("created_at", { ascending: false })

    if (appsErr) throw new Error(`Applications lookup failed: ${appsErr.message}`)

    const appIds = (applications || []).map((a: any) => a.id)

    // Fetch coach annotations for these applications
    let annotationsByApp: Record<string, any[]> = {}
    if (appIds.length > 0) {
      const { data: annotations } = await supabase
        .from("coach_annotations")
        .select("*")
        .in("application_id", appIds)
        .eq("coach_profile_id", profileId)
        .order("created_at", { ascending: false })

      for (const ann of annotations || []) {
        if (!annotationsByApp[ann.application_id]) annotationsByApp[ann.application_id] = []
        annotationsByApp[ann.application_id].push(ann)
      }
    }

    const enrichedApps = (applications || []).map((app: any) => ({
      ...app,
      interview_count: Array.isArray(app.signal_interviews) ? app.signal_interviews.length : 0,
      persona_name: app.client_personas?.name || null,
      signal_interviews: undefined,
      client_personas: undefined,
      coach_annotations: annotationsByApp[app.id] || [],
    }))

    // Fetch coach job recommendations for this client
    const { data: recommendations } = await supabase
      .from("coach_job_recommendations")
      .select("*")
      .eq("coach_profile_id", profileId)
      .eq("client_profile_id", clientProfileId)
      .order("created_at", { ascending: false })

    return withCorsJson(req, {
      ok: true,
      applications: enrichedApps,
      recommendations: recommendations || [],
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
