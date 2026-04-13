// app/api/coach/clients/route.ts
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

async function verifyCoach(profileId: string, supabase: any): Promise<boolean> {
  const { data } = await supabase
    .from("client_profiles")
    .select("is_coach")
    .eq("id", profileId)
    .single()
  return data?.is_coach === true
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const isCoach = await verifyCoach(profileId, supabase)
    if (!isCoach) {
      return withCorsJson(req, { ok: false, error: "Forbidden: caller is not a coach" }, 403)
    }

    // Fetch all active coach-client relationships
    const { data: relationships, error: relErr } = await supabase
      .from("coach_clients")
      .select("id, client_profile_id, invited_email, access_level, status, accepted_at, private_notes")
      .eq("coach_profile_id", profileId)
      .eq("status", "active")

    if (relErr) throw new Error(`Failed to fetch clients: ${relErr.message}`)

    const clientProfileIds = (relationships || [])
      .map((r: any) => r.client_profile_id)
      .filter(Boolean)

    // Fetch client profiles
    let profileMap: Record<string, any> = {}
    if (clientProfileIds.length > 0) {
      const { data: profiles } = await supabase
        .from("client_profiles")
        .select("id, name, email, target_roles, updated_at")
        .in("id", clientProfileIds)
      for (const p of profiles || []) {
        profileMap[p.id] = p
      }
    }

    // Build client list with stats
    const clients = await Promise.all(
      (relationships || []).map(async (rel: any) => {
        const clientProfileId = rel.client_profile_id
        const profile = clientProfileId ? profileMap[clientProfileId] : null

        let stats = {
          total_applications: 0,
          applied_count: 0,
          interviewing_count: 0,
          offers_count: 0,
          pending_recommendations: 0,
          last_activity_at: null as string | null,
        }

        if (clientProfileId) {
          // Query applications
          const { data: apps } = await supabase
            .from("signal_applications")
            .select("id, application_status, created_at")
            .eq("profile_id", clientProfileId)
            .order("created_at", { ascending: false })

          if (apps && apps.length > 0) {
            stats.total_applications = apps.length
            stats.applied_count = apps.filter((a: any) =>
              ["applied", "interviewing", "offer", "rejected", "withdrawn"].includes(a.application_status)
            ).length
            stats.interviewing_count = apps.filter((a: any) => a.application_status === "interviewing").length
            stats.offers_count = apps.filter((a: any) => a.application_status === "offer").length
            stats.last_activity_at = apps[0]?.created_at || null
          }

          // Query pending coach recommendations
          const { data: recs } = await supabase
            .from("coach_job_recommendations")
            .select("id, created_at")
            .eq("client_profile_id", clientProfileId)
            .eq("coach_profile_id", profileId)
            .is("client_status", null)

          if (recs && recs.length > 0) {
            stats.pending_recommendations = recs.length
            // Update last_activity_at if recs are more recent
            const lastRec = recs[0]?.created_at
            if (lastRec && (!stats.last_activity_at || lastRec > stats.last_activity_at)) {
              stats.last_activity_at = lastRec
            }
          }
        }

        const needs_attention =
          stats.pending_recommendations > 0 ||
          stats.interviewing_count > 0

        return {
          relationship_id: rel.id,
          client_profile_id: clientProfileId,
          client_email: rel.invited_email,
          access_level: rel.access_level,
          accepted_at: rel.accepted_at,
          client_name: profile?.name || null,
          target_roles: profile?.target_roles || null,
          ...stats,
          needs_attention,
        }
      })
    )

    // Sort: needs_attention DESC, last_activity_at DESC
    clients.sort((a, b) => {
      if (a.needs_attention !== b.needs_attention) return a.needs_attention ? -1 : 1
      const aTime = a.last_activity_at || ""
      const bTime = b.last_activity_at || ""
      return bTime.localeCompare(aTime)
    })

    return withCorsJson(req, { ok: true, clients })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
