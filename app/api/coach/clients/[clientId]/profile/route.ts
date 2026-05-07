// app/api/coach/clients/[clientId]/profile/route.ts
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

    // Bump last_viewed_at on the coach_clients link. Powers the "since
    // last visit" indicator on My Clients cards + the "no recent coach
    // activity" predicate in Requires Action heuristics. Any tab open
    // counts as "I saw recent activity" (decision 2026-05-07). Fire-
    // and-forget — failure is non-fatal and bumps again on next visit.
    supabase
      .from("coach_clients")
      .update({ last_viewed_at: new Date().toISOString() })
      .eq("id", access.id)
      .then(({ error: bumpErr }) => {
        if (bumpErr) console.warn("[coach profile GET] last_viewed_at bump failed:", bumpErr.message)
      })

    const { data: profile, error: profileErr } = await supabase
      .from("client_profiles")
      .select("*")
      .eq("id", clientProfileId)
      .single()

    if (profileErr) throw new Error(`Profile lookup failed: ${profileErr.message}`)
    if (!profile) return withCorsJson(req, { ok: false, error: "Client profile not found" }, 404)

    const { data: personas } = await supabase
      .from("client_personas")
      .select("*")
      .eq("profile_id", clientProfileId)
      .order("created_at", { ascending: false })

    return withCorsJson(req, {
      ok: true,
      profile,
      personas: personas || [],
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

// Editable fields on client_profiles when a coach patches the row from
// the Profile & Personas tab. Anything outside this allowlist is ignored.
// `name`, `email`, `resume_text`, and `profile_text` are intentionally
// excluded — those flow through other paths (auth, persona sync, intake).
const COACH_EDITABLE_PROFILE_FIELDS = new Set([
  "job_type",
  "target_roles",
  "target_locations",
  "timeline",
  "coach_notes_avoid",
  "coach_notes_strengths",
  "coach_notes_concerns",
])

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

    // Pilot decision (2026-05-07): profile edits require access_level = 'full'.
    // Annotate-only coaches see the page but can't write.
    const access = await verifyCoachAccess(profileId, clientProfileId, "full", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: full access required" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const updates: Record<string, any> = {}
    for (const [k, v] of Object.entries(body)) {
      if (!COACH_EDITABLE_PROFILE_FIELDS.has(k)) continue
      if (v === undefined) continue
      // Empty string → null (so coach can clear a field by blanking it)
      const str = v === null ? null : String(v)
      updates[k] = str !== null && str.trim().length === 0 ? null : str
    }

    if (Object.keys(updates).length === 0) {
      return withCorsJson(req, { ok: false, error: "No editable fields supplied" }, 400)
    }

    updates.updated_at = new Date().toISOString()

    const { data: updated, error: updateErr } = await supabase
      .from("client_profiles")
      .update(updates)
      .eq("id", clientProfileId)
      .select("*")
      .single()

    if (updateErr) throw new Error(`Profile update failed: ${updateErr.message}`)

    return withCorsJson(req, { ok: true, profile: updated })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
